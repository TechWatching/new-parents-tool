import { ref } from 'vue'
import type { SyncStatus } from './types'
import type { AppData } from './types'
import { isSupabaseConfigured } from './supabase'
import { mergeDataStrict, finishSync, markDirty, isDirty, type Namespace } from './storage'
import { mergeAppData } from './merge'
import { pullAll, pushFeeds, pushWeights } from './remote'

export const syncStatus = ref<SyncStatus>('idle')
export const syncError = ref<string | null>(null)
export const lastSyncedAt = ref<Date | null>(null)

export function resetSyncState() {
  syncStatus.value = 'idle'
  syncError.value = null
  lastSyncedAt.value = null
}

export interface SyncContext {
  isCurrent: () => boolean
  signal: AbortSignal
}

/**
 * Perform a full bidirectional sync:
 *  1. Pull remote data
 *  2. Merge with local (newest updatedAt wins)
 *  3. Save merged result locally
 *  4. Push merged result to remote
 *  5. Acknowledge only the sent snapshot, retaining newer pending changes
 *
 * Returns the merged AppData so callers can update reactive state.
 */
export async function syncNow(
  userId: string,
  namespace: Namespace,
  localData: AppData,
  context?: SyncContext,
): Promise<AppData> {
  if (!isSupabaseConfigured) return localData
  if (namespace !== `user-${userId}`) {
    throw new Error('The sync identity does not match its storage namespace')
  }
  const assertCurrent = () => {
    if (context && (!context.isCurrent() || context.signal.aborted))
      throw new DOMException('The active identity changed', 'AbortError')
  }
  assertCurrent()

  syncStatus.value = 'syncing'
  syncError.value = null

  try {
    const remote = await pullAll(userId, context?.signal)
    assertCurrent()
    const merged = await mergeDataStrict(mergeAppData(localData, remote), namespace)
    assertCurrent()
    await pushFeeds(userId, merged.feeds, context?.signal)
    assertCurrent()
    await pushWeights(userId, merged.weights, context?.signal)
    assertCurrent()
    const result = await finishSync(merged, namespace)
    assertCurrent()
    syncStatus.value = result.pending ? 'pending' : 'synced'
    lastSyncedAt.value = new Date()
    return result.data
  } catch (err) {
    if (!context || (context.isCurrent() && !context.signal.aborted)) {
      syncStatus.value = 'error'
      syncError.value = err instanceof Error ? err.message : String(err)
      await markDirty(namespace)
    }
    throw err
  }
}

/**
 * Mark the namespace as dirty (pending sync) when authenticated and
 * Supabase is configured.  Called every time local data is mutated.
 */
export async function onLocalMutation(namespace: Namespace): Promise<void> {
  if (!isSupabaseConfigured) return
  await markDirty(namespace)
  if (syncStatus.value !== 'syncing') syncStatus.value = 'pending'
}

/** Returns true if there are unsynchronised local changes. */
export async function hasPendingSync(namespace: Namespace): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  return isDirty(namespace)
}
