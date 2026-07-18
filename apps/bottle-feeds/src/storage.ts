import { createStorage, prefixStorage, type Driver } from 'unstorage'
import type { AppData, Feed, Weight } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GUEST_NAMESPACE = 'guest'
export const DATA_KEY = 'data'
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
// Validation & metadata helpers
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
 * - Returns empty collections on failure or corrupt data.
 */
export async function loadData(namespace: Namespace = GUEST_NAMESPACE): Promise<AppData> {
  try {
    const storage = await getStorage(namespace)
    const stored = await storage.getItem<unknown>(DATA_KEY)

    if (stored !== null && isValidAppData(stored)) {
      return addMissingMetadata(stored as AppData)
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