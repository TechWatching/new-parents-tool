import { shallowRef } from 'vue'
import type { CloudBackend, Mutation } from './backends/contracts'
import { loadHistory, readLocalContext, updateHistory, type Namespace } from './storage'
import {
  applyRemote, getRecord, mutationFor, putRecord, recordKey,
  type HistoryState,
} from './sharing/state'
import type { SyncStatus } from './types'
import { cloudRequest } from './sharing/request'

export const syncStatus = shallowRef<SyncStatus>('idle')
export const syncError = shallowRef<string | null>(null)
export const lastSyncedAt = shallowRef<Date | null>(null)

export function resetSyncState() {
  syncStatus.value = 'idle'
  syncError.value = null
  lastSyncedAt.value = null
}

export interface SyncContext {
  isCurrent: () => boolean
  signal: AbortSignal
  contextRevision?: string
}

/** Reconcile a bounded delta, then submit only each record's oldest request. */
export async function syncNow(
  backend: CloudBackend,
  familyId: string,
  namespace: Namespace,
  context: SyncContext,
): Promise<HistoryState> {
  const leaseId = crypto.randomUUID()
  const assertContext = () => context.isCurrent() && !context.signal.aborted
  const acquired = await updateHistory(namespace, (state) => {
    if (!state.syncLease || state.syncLease.until <= Date.now()) {
      state.syncLease = { id: leaseId, until: Date.now() + 30_000 }
    }
  }, assertContext, context.contextRevision)
  if (acquired.syncLease?.id !== leaseId) return acquired
  try {
    return await reconcile(backend, familyId, namespace, context, leaseId)
  } finally {
    // The bounded lease recovers a crashed tab. A late owner cannot release a
    // replacement lease or apply a response after another tab took ownership.
    await updateHistory(namespace, (state) => {
      if (state.syncLease?.id === leaseId) delete state.syncLease
    }).catch(() => {})
  }
}

async function reconcile(
  backend: CloudBackend,
  familyId: string,
  namespace: Namespace,
  context: SyncContext,
  leaseId: string,
): Promise<HistoryState> {
  const current = () => context.isCurrent() && !context.signal.aborted
  const check = () => {
    if (!current()) throw new DOMException('The active history changed', 'AbortError')
  }
  const checkDurable = async () => {
    check()
    if (context.contextRevision !== undefined) {
      const saved = await readLocalContext<{ revision: string }>()
      if (saved?.revision !== context.contextRevision) throw new DOMException('The active history changed in another tab', 'AbortError')
      check()
    }
    await updateHistory(namespace, (state) => {
      checkLease(state)
      state.syncLease = { id: leaseId, until: Date.now() + 30_000 }
    }, current, context.contextRevision)
  }
  const checkLease = (state: HistoryState) => {
    if (state.syncLease?.id !== leaseId) throw new DOMException('Another tab owns synchronization', 'AbortError')
  }
  check()
  syncStatus.value = 'syncing'
  syncError.value = null
  try {
    let state = await loadHistory(namespace)
    check()
    const cursor = state.cursor
    let page: string | null = null
    const pages = new Set<string>()
    do {
      await checkDurable()
      const delta = await cloudRequest((signal) => backend.sync.pull(familyId, cursor, page, signal), context.signal)
      check()
      if (delta.nextPage && pages.has(delta.nextPage)) throw new Error('Repeated sync page')
      if (delta.nextPage) pages.add(delta.nextPage)
      state = await updateHistory(namespace, (latest) => {
        checkLease(latest)
        for (const remote of delta.records) applyRemote(latest, remote)
        if (delta.nextPage === null) latest.cursor = delta.cursor
      }, current, context.contextRevision)
      page = delta.nextPage
    } while (page !== null)
    check()
    // One request per record. Successors are reissued with a new UUID only
    // after their predecessor's receipt establishes the correct base version.
    const selected = new Map<string, Mutation>()
    const blocked = new Set(state.conflicts.map((item) => item.id))
    for (const mutation of state.pending) {
      const key = recordKey(mutation.kind, mutation.record.id)
      if (!blocked.has(key) && !selected.has(key)) selected.set(key, mutation)
      if (selected.size >= 100) break
    }
    const outgoing = [...selected.values()]
    if (outgoing.length) {
      await checkDurable()
      const results = await cloudRequest((signal) => backend.sync.push(familyId, outgoing, signal), context.signal)
      check()
      state = await updateHistory(namespace, (latest) => {
        checkLease(latest)
        for (const result of results) {
          const sent = outgoing.find((item) => item.mutationId === result.mutationId)
          if (!sent) throw new Error('Unexpected mutation receipt')
          const index = latest.pending.findIndex((item) => item.mutationId === sent.mutationId)
          if (index < 0) continue // Another tab has already applied this exact receipt.
          const key = recordKey(sent.kind, sent.record.id)
          if (result.current && (result.current.kind !== sent.kind || result.current.record.id !== sent.record.id)) {
            throw new Error('Mismatched mutation receipt')
          }
          if (result.status === 'conflict') {
            const existing = latest.conflicts.find((item) => item.id === key)
            if (!existing) latest.conflicts.push({
              id: key, kind: sent.kind, source: 'cloud',
              local: { ...(getRecord(latest, sent.kind, sent.record.id) ?? sent.record) },
              remote: result.current,
              base: latest.bases[sent.mutationId] ?? null,
            })
            else if (existing.source !== 'local' && existing.source !== 'restore') existing.remote = result.current
            if (result.current) latest.versions[key] = result.current
            else delete latest.versions[key]
            continue
          }
          latest.pending.splice(index, 1)
          delete latest.bases[sent.mutationId]
          latest.versions[key] = result.current
          const successors = latest.pending.filter((item) => recordKey(item.kind, item.record.id) === key)
          if (successors.length) {
            // None of these successors has been sent: selection always takes
            // the first request for a key. Keep every local edit recoverable.
            latest.pending = latest.pending.map((item) => {
              if (!successors.includes(item)) return item
              const rebased = mutationFor(item.kind, item.record, result.current.version)
              delete latest.bases[item.mutationId]
              latest.bases[rebased.mutationId] = result.current
              return rebased
            })
          } else if (!latest.conflicts.some((item) => item.id === key)) {
            putRecord(latest, result.current.kind, result.current.record)
          }
        }
      }, current, context.contextRevision)
    }
    check()
    syncStatus.value = state.pending.length || state.conflicts.length ? 'pending' : 'synced'
    lastSyncedAt.value = new Date()
    return state
  } catch (error) {
    if (current()) {
      syncStatus.value = 'error'
      syncError.value = error instanceof Error ? error.message : String(error)
    }
    throw error
  }
}

export async function resolveStoredConflict(
  namespace: Namespace,
  id: string,
  choice: 'local' | 'remote',
  shared: boolean,
  isCurrent?: () => boolean,
) {
  return updateHistory(namespace, (state) => {
    const conflict = state.conflicts.find((item) => item.id === id)
    if (!conflict) return
    const key = recordKey(conflict.kind, conflict.local.id)
    state.pending = state.pending.filter((item) => {
      if (recordKey(item.kind, item.record.id) !== key) return true
      delete state.bases[item.mutationId]
      return false
    })
    state.conflicts = state.conflicts.filter((item) => item.id !== id)
    if (choice === 'remote') {
      if (conflict.remote) putRecord(state, conflict.kind, conflict.remote.record)
      else putRecord(state, conflict.kind, {
        ...conflict.local, deletedAt: conflict.local.deletedAt ?? new Date().toISOString(),
      })
      if (shared && conflict.source === 'local' && conflict.remote) {
        const mutation = mutationFor(conflict.kind, conflict.remote.record, conflict.base?.version ?? null)
        state.pending.push(mutation)
        state.bases[mutation.mutationId] = conflict.base
      }
    } else {
      putRecord(state, conflict.kind, conflict.local)
      if (shared) {
        const base = conflict.source === 'local' ? conflict.base : conflict.remote
        const mutation = mutationFor(conflict.kind, conflict.local, base?.version ?? null)
        state.pending.push(mutation)
        state.bases[mutation.mutationId] = base
      }
    }
  }, isCurrent)
}

export async function hasPendingSync(namespace: Namespace) {
  const state = await loadHistory(namespace)
  return Boolean(state.pending.length || state.conflicts.length)
}
