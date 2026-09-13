import type { CloudRecord, Mutation } from './backends/contracts'
import type { Feed, Weight } from './types'
import { parseAppData } from './validation'
import { emptyHistory, type HistoryState, type SyncConflict } from './sharing/state'

export interface RecoveryBackup {
  format: 'little-sips-backup'
  version: 1
  records: HistoryState['data']
  recovery: Omit<HistoryState, 'data'>
  provenance: { backendId: string | null; namespace: string }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup object')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid backup identifier')
  return value
}
function kindOf(value: unknown): 'feed' | 'weight' {
  if (value !== 'feed' && value !== 'weight') throw new Error('Invalid backup record kind')
  return value
}
function row(kind: 'feed' | 'weight', value: unknown): Feed | Weight {
  const data = parseAppData(kind === 'feed' ? { feeds: [value], weights: [] } : { feeds: [], weights: [value] })
  return kind === 'feed' ? data.feeds[0]! : data.weights[0]!
}
function cloud(value: unknown): CloudRecord | null {
  if (value === null) return null
  const source = object(value)
  const kind = kindOf(source.kind)
  if (typeof source.version !== 'string') throw new Error('Invalid backup revision')
  return { kind, record: row(kind, source.record), version: source.version } as CloudRecord
}

/** Whitelist every field: backups never serialize SDK state or credentials. */
export function parseBackup(value: unknown): HistoryState {
  const source = object(value)
  if (!('version' in source) && !('format' in source)) return { ...emptyHistory(), data: parseAppData(value) }
  if (source.version !== 1 || source.format !== 'little-sips-backup') throw new Error('Unsupported backup version')
  const recovery = object(source.recovery)
  if (!Array.isArray(recovery.pending) || !Array.isArray(recovery.conflicts)) throw new Error('Invalid backup recovery')
  const pending: Mutation[] = recovery.pending.map((value: unknown) => {
    const mutation = object(value)
    const kind = kindOf(mutation.kind)
    if (mutation.baseVersion !== null && typeof mutation.baseVersion !== 'string') throw new Error('Invalid backup base version')
    return {
      mutationId: text(mutation.mutationId), kind, record: row(kind, mutation.record),
      baseVersion: mutation.baseVersion,
    } as Mutation
  })
  if (new Set(pending.map((item) => item.mutationId)).size !== pending.length) throw new Error('Duplicate backup mutation')
  const conflicts: SyncConflict[] = recovery.conflicts.map((value: unknown) => {
    const conflict = object(value)
    const kind = kindOf(conflict.kind)
    const local = row(kind, conflict.local)
    const remote = cloud(conflict.remote)
    const base = cloud(conflict.base ?? null)
    for (const candidate of [remote, base]) {
      if (candidate && (candidate.kind !== kind || candidate.record.id !== local.id)) throw new Error('Mismatched backup conflict')
    }
    if (conflict.source !== undefined && !['local', 'cloud', 'restore'].includes(String(conflict.source))) {
      throw new Error('Invalid backup conflict source')
    }
    return {
      id: text(conflict.id), kind, local, remote, base,
      ...(conflict.source ? { source: conflict.source as SyncConflict['source'] } : {}),
    }
  })
  if (new Set(conflicts.map((item) => item.id)).size !== conflicts.length) throw new Error('Duplicate backup conflict')
  const versions: Record<string, CloudRecord> = {}
  for (const [key, value] of Object.entries(object(recovery.versions))) {
    const record = cloud(value)
    if (!record || key !== `${record.kind}:${record.record.id}`) throw new Error('Invalid backup version key')
    versions[key] = record
  }
  const bases: Record<string, CloudRecord | null> = {}
  for (const [id, value] of Object.entries(object(recovery.bases ?? {}))) {
    const base = cloud(value)
    const mutation = pending.find((item) => item.mutationId === id)
    if (!mutation || (base && (base.kind !== mutation.kind || base.record.id !== mutation.record.id))) {
      throw new Error('Invalid backup mutation base')
    }
    bases[id] = base
  }
  if (recovery.cursor !== null && typeof recovery.cursor !== 'string') throw new Error('Invalid backup cursor')
  return { data: parseAppData(source.records), pending, conflicts, versions, bases, cursor: recovery.cursor }
}

export function createBackup(
  state: HistoryState,
  provenance: RecoveryBackup['provenance'],
): RecoveryBackup {
  const sanitized = parseBackup({
    format: 'little-sips-backup', version: 1, records: state.data,
    recovery: { pending: state.pending, conflicts: state.conflicts, versions: state.versions, bases: state.bases, cursor: state.cursor },
  })
  const { data: records, ...recovery } = sanitized
  return {
    format: 'little-sips-backup', version: 1, records, recovery,
    provenance: { backendId: provenance.backendId, namespace: provenance.namespace },
  }
}
