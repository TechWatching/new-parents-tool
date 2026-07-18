import { ref } from 'vue'
import type { SyncStatus } from './types'
import type { AppData } from './types'
import { isSupabaseConfigured } from './supabase'
import { saveData, clearDirty, markDirty, isDirty, type Namespace } from './storage'
import { mergeAppData } from './merge'
import { pullAll, pushFeeds, pushWeights } from './remote'

export const syncStatus = ref<SyncStatus>('idle')
export const syncError = ref<string | null>(null)
export const lastSyncedAt = ref<Date | null>(null)

let _activeSyncPromise: Promise<void> | null = null

/**
 * Perform a full bidirectional sync:
 *  1. Pull remote data
 *  2. Merge with local (newest updatedAt wins)
 *  3. Save merged result locally
 *  4. Push merged result to remote
 *  5. Clear the dirty flag
 *
 * Returns the merged AppData so callers can update reactive state.
 */
export async function syncNow(
  userId: string,
  namespace: Namespace,
  localData: AppData,
): Promise<AppData> {
  if (!isSupabaseConfigured) return localData

  if (_activeSyncPromise) {
    await _activeSyncPromise
    return localData
  }

  syncStatus.value = 'syncing'
  syncError.value = null

  let merged = localData
  _activeSyncPromise = (async () => {
    try {
      const remote = await pullAll(userId)
      merged = mergeAppData(localData, remote)
      await saveData(merged, namespace)
      await pushFeeds(userId, merged.feeds)
      await pushWeights(userId, merged.weights)
      await clearDirty(namespace)
      syncStatus.value = 'synced'
      lastSyncedAt.value = new Date()
    } catch (err) {
      syncStatus.value = 'error'
      syncError.value = err instanceof Error ? err.message : String(err)
      // Mark dirty so the next opportunity retries.
      await markDirty(namespace)
      throw err
    } finally {
      _activeSyncPromise = null
    }
  })()

  await _activeSyncPromise
  return merged
}

/**
 * Mark the namespace as dirty (pending sync) when authenticated and
 * Supabase is configured.  Called every time local data is mutated.
 */
export async function onLocalMutation(namespace: Namespace): Promise<void> {
  if (!isSupabaseConfigured) return
  await markDirty(namespace)
  syncStatus.value = 'pending'
}

/** Returns true if there are unsynchronised local changes. */
export async function hasPendingSync(namespace: Namespace): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  return isDirty(namespace)
}
