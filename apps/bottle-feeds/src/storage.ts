import { createStorage, prefixStorage, type Driver } from 'unstorage'
import type { AppData, Feed, Weight } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Legacy localStorage key – kept for backwards-compat and migration. */
export const STORAGE_KEY = 'new-parents-tool:bottle-feeds:v1'

export const GUEST_NAMESPACE = 'guest'
export const DATA_KEY = 'data'
export const MIGRATION_FLAG_KEY = 'migrated-from-v1'
export const SYNC_DIRTY_KEY = 'sync-dirty'

export type Namespace = typeof GUEST_NAMESPACE | `user-${string}`

// ---------------------------------------------------------------------------
// Test injection
// ---------------------------------------------------------------------------

let _testDriver: Driver | null = null

/**
 * Override the storage driver used by all storage operations.
 * Pass `null` to revert to the real IndexedDB driver.
 * ONLY intended for use in unit tests.
 */
export function _setTestDriver(driver: Driver | null): void {
  _testDriver = driver
  _storageCache.clear()
}

// ---------------------------------------------------------------------------
// Internal storage factory
// ---------------------------------------------------------------------------

const _storageCache = new Map<string, ReturnType<typeof createStorage>>()

async function getStorage(namespace: Namespace) {
  const cached = _storageCache.get(namespace)
  if (cached) return cached

  let driver: Driver
  if (_testDriver) {
    driver = _testDriver
  } else {
    try {
      // Note: unstorage ships the IndexedDB driver as 'indexedb' (one 'd').
      // This is the correct import path in the package — not a typo.
      const { default: indexedbDriver } = await import('unstorage/drivers/indexedb')
      driver = indexedbDriver({
        dbName: 'new-parents-tool',
        storeName: 'bottle-feeds',
        base: namespace,
      })
    } catch {
      // Fallback to in-memory when IndexedDB is unavailable (e.g., Node.js env).
      const { default: memoryDriver } = await import('unstorage/drivers/memory')
      driver = memoryDriver()
    }
  }

  const base = createStorage({ driver })
  // When using the injected test driver (which has no built-in namespace
  // isolation), apply an explicit key prefix per namespace so that different
  // namespaces stay isolated within the same in-memory store.
  const storage = _testDriver ? prefixStorage(base, namespace) : base
  _storageCache.set(namespace, storage)
  return storage
}

// ---------------------------------------------------------------------------
// Validation & metadata helpers (exported so migration.ts can reuse them)
// ---------------------------------------------------------------------------

export function isValidAppData(value: unknown): value is AppData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AppData).feeds) &&
    Array.isArray((value as AppData).weights)
  )
}

/** Backfill `updatedAt` for records imported from the old schema. */
export function addMissingMetadata(data: AppData): AppData {
  const now = new Date().toISOString()
  const backfillFeeds = (feeds: Feed[]): Feed[] =>
    feeds.map((f) => ({ ...f, updatedAt: f.updatedAt ?? f.occurredAt ?? now }))
  const backfillWeights = (weights: Weight[]): Weight[] =>
    weights.map((w) => ({ ...w, updatedAt: w.updatedAt ?? w.occurredAt ?? now }))
  return { feeds: backfillFeeds(data.feeds), weights: backfillWeights(data.weights) }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load app data for the given namespace.
 * - If IndexedDB contains valid data it is returned (with missing metadata
 *   backfilled).
 * - If there is no IndexedDB data yet and this is the guest namespace,
 *   attempts a one-time migration from the legacy localStorage key.
 * - Returns empty collections on failure or corrupt data.
 */
export async function loadData(namespace: Namespace = GUEST_NAMESPACE): Promise<AppData> {
  try {
    const storage = await getStorage(namespace)
    const stored = await storage.getItem<unknown>(DATA_KEY)

    if (stored !== null && isValidAppData(stored)) {
      return addMissingMetadata(stored as AppData)
    }

    // No valid IndexedDB data – attempt legacy migration for guest namespace only.
    if (namespace === GUEST_NAMESPACE) {
      const alreadyMigrated = await storage.getItem<boolean>(MIGRATION_FLAG_KEY)
      if (!alreadyMigrated) {
        const legacyData = readLegacyLocalStorage()
        if (legacyData && isValidAppData(legacyData)) {
          const withMeta = addMissingMetadata(legacyData)
          // Persist to IndexedDB FIRST; only then mark as migrated.
          await storage.setItem(DATA_KEY, withMeta)
          await storage.setItem(MIGRATION_FLAG_KEY, true)
          return withMeta
        }
        // Nothing to migrate – just record that we checked.
        await storage.setItem(MIGRATION_FLAG_KEY, true)
      }
    }
  } catch (error) {
    console.warn('[storage] loadData failed:', error)
  }

  return { feeds: [], weights: [] }
}

/**
 * Persist app data for the given namespace.
 */
export async function saveData(
  data: AppData,
  namespace: Namespace = GUEST_NAMESPACE,
): Promise<void> {
  try {
    const storage = await getStorage(namespace)
    await storage.setItem(DATA_KEY, data)
  } catch (error) {
    console.warn('[storage] saveData failed:', error)
  }
}

// ---------------------------------------------------------------------------
// Sync dirty flag
// ---------------------------------------------------------------------------

/** Mark that local data has unsynchronised changes. */
export async function markDirty(namespace: Namespace): Promise<void> {
  try {
    const storage = await getStorage(namespace)
    await storage.setItem(SYNC_DIRTY_KEY, true)
  } catch {
    /* non-critical */
  }
}

/** Clear the dirty flag after a successful sync. */
export async function clearDirty(namespace: Namespace): Promise<void> {
  try {
    const storage = await getStorage(namespace)
    await storage.removeItem(SYNC_DIRTY_KEY)
  } catch {
    /* non-critical */
  }
}

/** Returns true when there are local changes that have not been synced. */
export async function isDirty(namespace: Namespace): Promise<boolean> {
  try {
    const storage = await getStorage(namespace)
    return Boolean(await storage.getItem<boolean>(SYNC_DIRTY_KEY))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Internal: read legacy localStorage (only used during migration)
// ---------------------------------------------------------------------------

function readLegacyLocalStorage(): AppData | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValidAppData(parsed) ? (parsed as AppData) : null
  } catch {
    return null
  }
}
