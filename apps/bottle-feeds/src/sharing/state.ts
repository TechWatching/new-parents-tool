import type { CloudRecord, Mutation } from '../backends/contracts'
import type { AppData, Feed, Weight } from '../types'

export interface SyncConflict {
  id: string
  kind: 'feed' | 'weight'
  local: Feed | Weight
  remote: CloudRecord | null
  base: CloudRecord | null
  source?: 'local' | 'cloud' | 'restore'
}

export interface HistoryState {
  data: AppData
  pending: Mutation[]
  conflicts: SyncConflict[]
  versions: Record<string, CloudRecord>
  bases: Record<string, CloudRecord | null>
  cursor: string | null
  syncLease?: { id: string; until: number }
}

export const recordKey = (kind: 'feed' | 'weight', id: string) => `${kind}:${id}`
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}
export const sameRecord = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
export const emptyHistory = (): HistoryState => ({
  data: { feeds: [], weights: [] }, pending: [], conflicts: [], versions: {}, bases: {}, cursor: null,
})
export const cloneHistory = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function getRecord(state: HistoryState, kind: 'feed' | 'weight', id: string) {
  return (kind === 'feed' ? state.data.feeds : state.data.weights).find((row) => row.id === id)
}

export function putRecord(state: HistoryState, kind: 'feed' | 'weight', record: Feed | Weight) {
  if (kind === 'feed') {
    state.data.feeds = [...state.data.feeds.filter((row) => row.id !== record.id), record as Feed]
  } else {
    state.data.weights = [...state.data.weights.filter((row) => row.id !== record.id), record as Weight]
  }
}

export function mutationFor(kind: 'feed' | 'weight', record: Feed | Weight, baseVersion: string | null): Mutation {
  return { mutationId: crypto.randomUUID(), kind, record: { ...record }, baseVersion } as Mutation
}

/** Apply only the user's changed records, never a stale tab's whole snapshot. */
export function applyLocalEdit(state: HistoryState, before: AppData, after: AppData, shared: boolean) {
  for (const kind of ['feed', 'weight'] as const) {
    const old = kind === 'feed' ? before.feeds : before.weights
    const next = kind === 'feed' ? after.feeds : after.weights
    for (const row of next) {
      const prior = old.find((item) => item.id === row.id)
      if (sameRecord(row, prior)) continue
      const key = recordKey(kind, row.id)
      const existing = getRecord(state, kind, row.id)
      // Concurrent local-tab changes get the same explicit alternatives as server conflicts.
      if (existing && prior && !sameRecord(existing, prior) && !sameRecord(existing, row)) {
        const conflict = state.conflicts.find((item) => item.id === key)
        if (!conflict) state.conflicts.push({
          id: key, kind, local: { ...row }, source: 'local',
          remote: { kind, record: { ...existing }, version: '' } as CloudRecord,
          base: state.versions[key] ?? null,
        })
      }
      putRecord(state, kind, row)
      const conflict = state.conflicts.find((item) => item.id === key)
      if (conflict) conflict.local = { ...row }
      if (shared && !sameRecord(existing, row)) {
        const mutation = mutationFor(kind, row, state.versions[key]?.version ?? null)
        state.pending.push(mutation)
        state.bases[mutation.mutationId] = state.versions[key] ?? null
      }
    }
  }
}

/** Server authority is ordered by the adapter, never by a phone's clock. */
export function applyRemote(state: HistoryState, remote: CloudRecord) {
  const key = recordKey(remote.kind, remote.record.id)
  state.versions[key] = remote
  const conflict = state.conflicts.find((item) => item.id === key)
  if (conflict) {
    if (conflict.source !== 'local' && conflict.source !== 'restore') conflict.remote = remote
    return
  }
  // Pending mutations must get their idempotent receipt first. A pulled record
  // may be our own successful write whose response was lost.
  if (state.pending.some((item) => recordKey(item.kind, item.record.id) === key)) return
  putRecord(state, remote.kind, remote.record)
}
