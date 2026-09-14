import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import memoryDriver from 'unstorage/drivers/memory'
import type { CloudBackend, CloudRecord, Mutation, MutationResult } from '../backends/contracts'
import { _setTestDriver, loadHistory, updateHistory, writeLocalContext } from '../storage'
import { applyLocalEdit, emptyHistory, recordKey } from '../sharing/state'
import { resolveStoredConflict, resetSyncState, syncNow, syncStatus } from '../sync'
import { createBackup, parseBackup } from '../backup'
import type { Feed } from '../types'

const feed = (id = 'f1', amount = 120): Feed => ({
  id, amount, occurredAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z', comment: '',
})
const ns = 'shared-test~a~family' as const
const context = () => ({ isCurrent: () => true, signal: new AbortController().signal })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** A non-provider adapter: opaque versions and immutable idempotent receipts. */
function fakeBackend() {
  const rows = new Map<string, CloudRecord>()
  const receipts = new Map<string, MutationResult>()
  let version = 0
  const backend = {
    id: 'test',
    auth: { restore: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), onChange: vi.fn(() => () => {}) },
    family: {
      current: vi.fn(), create: vi.fn(), invite: vi.fn(), revokeInvitation: vi.fn(),
      join: vi.fn(), leave: vi.fn(), removeMember: vi.fn(), delete: vi.fn(),
    },
    sync: {
      pull: vi.fn(async () => ({ records: [...rows.values()], cursor: `watermark:${version}`, nextPage: null as string | null })),
      push: vi.fn(async (_family: string, mutations: Mutation[]): Promise<MutationResult[]> => mutations.map((mutation) => {
        const receipt = receipts.get(mutation.mutationId)
        if (receipt) return receipt
        const key = recordKey(mutation.kind, mutation.record.id)
        const current = rows.get(key) ?? null
        let result: MutationResult
        if ((current?.version ?? null) !== mutation.baseVersion) {
          result = { mutationId: mutation.mutationId, status: 'conflict', current }
        } else {
          const accepted = { kind: mutation.kind, record: { ...mutation.record }, version: `opaque:${++version}` } as CloudRecord
          rows.set(key, accepted)
          result = { mutationId: mutation.mutationId, status: 'accepted', current: accepted }
        }
        receipts.set(mutation.mutationId, result)
        return result
      })),
    },
    dispose: vi.fn(),
  } satisfies CloudBackend
  return { backend, rows, receipts }
}
async function edit(record: Feed) {
  return updateHistory(ns, (state) => {
    const before = JSON.parse(JSON.stringify(state.data))
    const after = { ...before, feeds: [...before.feeds.filter((item: Feed) => item.id !== record.id), record] }
    applyLocalEdit(state, before, after, true)
  })
}

describe('durable backend-neutral conditional synchronization', () => {
  beforeEach(() => { _setTestDriver(memoryDriver()); resetSyncState() })
  afterEach(() => { _setTestDriver(null); vi.restoreAllMocks() })

  it('uploads only pending records, never echoes hydration or unrelated records', async () => {
    const { backend, rows } = fakeBackend()
    rows.set('feed:old', { kind: 'feed', record: feed('old'), version: 'remote-version' })
    await syncNow(backend, 'family', ns, context())
    expect(backend.sync.push).not.toHaveBeenCalled()
    await edit(feed('new'))
    const state = await syncNow(backend, 'family', ns, context())
    expect(backend.sync.push.mock.calls[0]![1].map((item) => item.record.id)).toEqual(['new'])
    expect(state.pending).toEqual([])
    expect(state.data.feeds).toHaveLength(2)
    expect(syncStatus.value).toBe('synced')
  })

  it('keeps remote authority despite a phone timestamp far in the future', async () => {
    const { backend, rows } = fakeBackend()
    await updateHistory(ns, (state) => {
      state.data.feeds = [{ ...feed(), updatedAt: '2099-01-01T12:00:00.000Z' }]
    })
    rows.set('feed:f1', { kind: 'feed', record: feed('f1', 90), version: 'server' })
    const state = await syncNow(backend, 'family', ns, context())
    expect(state.data.feeds[0]!.amount).toBe(90)
  })

  it('acknowledges exact mutations and rebases unsent edits with new UUIDs', async () => {
    const { backend } = fakeBackend()
    await edit(feed())
    const gate = deferred<MutationResult[]>()
    const push = backend.sync.push.getMockImplementation()!
    backend.sync.push.mockImplementationOnce(async (...args) => {
      const results = await push(...args)
      await gate.promise
      return results
    })
    const syncing = syncNow(backend, 'family', ns, context())
    await vi.waitFor(() => expect(backend.sync.push).toHaveBeenCalledOnce())
    const during = await edit(feed('f1', 180))
    const successor = during.pending[1]!
    gate.resolve([])
    const first = await syncing
    expect(first.data.feeds[0]!.amount).toBe(180)
    expect(first.pending).toHaveLength(1)
    expect(first.pending[0]!.mutationId).not.toBe(successor.mutationId)
    expect(first.pending[0]!.baseVersion).toBe('opaque:1')
    const final = await syncNow(backend, 'family', ns, context())
    expect(final.pending).toEqual([])
    expect(final.data.feeds[0]!.amount).toBe(180)
  })

  it('retries the identical request after server commit and response loss', async () => {
    const { backend } = fakeBackend()
    await edit(feed())
    const push = backend.sync.push.getMockImplementation()!
    backend.sync.push.mockImplementationOnce(async (...args) => {
      await push(...args)
      throw new Error('Response lost after commit')
    })
    await expect(syncNow(backend, 'family', ns, context())).rejects.toThrow('Response lost')
    const queued = (await loadHistory(ns)).pending
    expect(queued).toHaveLength(1)
    const result = await syncNow(backend, 'family', ns, context())
    expect(backend.sync.push.mock.calls[1]![1]).toEqual(queued)
    expect(result.pending).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('retains edit/delete alternatives and CAS-resolves against current authority', async () => {
    const { backend, rows } = fakeBackend()
    rows.set('feed:f1', { kind: 'feed', record: feed(), version: 'base' })
    await syncNow(backend, 'family', ns, context())
    await edit(feed('f1', 180))
    const deleted = { ...feed(), deletedAt: '2026-01-02T12:00:00.000Z' }
    rows.set('feed:f1', { kind: 'feed', record: deleted, version: 'deleted' })
    const conflict = await syncNow(backend, 'family', ns, context())
    expect(conflict.conflicts[0]!.local).toEqual(feed('f1', 180))
    expect(conflict.conflicts[0]!.remote!.record.deletedAt).toBeDefined()
    expect(conflict.conflicts[0]!.base?.version).toBe('base')
    const resolved = await resolveStoredConflict(ns, 'feed:f1', 'local', true)
    expect(resolved.pending[0]!.baseVersion).toBe('deleted')
    rows.set('feed:f1', { kind: 'feed', record: feed('f1', 200), version: 'intervening' })
    const again = await syncNow(backend, 'family', ns, context())
    expect(again.conflicts).toHaveLength(1)
    expect(rows.get('feed:f1')!.record).toEqual(feed('f1', 200))
    const shared = await resolveStoredConflict(ns, 'feed:f1', 'remote', true)
    expect(shared.data.feeds[0]!.amount).toBe(200)
    expect(shared.pending).toEqual([])
  })

  it('continues syncing unrelated records while a conflict is unresolved', async () => {
    const { backend, rows } = fakeBackend()
    await edit(feed())
    rows.set('feed:f1', { kind: 'feed', record: feed('f1', 200), version: 'server' })
    await syncNow(backend, 'family', ns, context())
    await edit(feed('unrelated'))
    const state = await syncNow(backend, 'family', ns, context())
    expect(state.conflicts).toHaveLength(1)
    expect(rows.has('feed:unrelated')).toBe(true)
    expect(backend.sync.push.mock.calls[1]![1]).toHaveLength(1)
  })

  it('loads over 1000 records in bounded pages and commits cursor only at completion', async () => {
    const { backend } = fakeBackend()
    const records: CloudRecord[] = Array.from({ length: 1205 }, (_, index) => ({
      kind: 'feed', record: feed(`f${index}`), version: `version:${index}`,
    }))
    backend.sync.pull.mockResolvedValueOnce({ records: records.slice(0, 1000), cursor: 'watermark', nextPage: 'page-2' })
      .mockRejectedValueOnce(new Error('offline'))
    await expect(syncNow(backend, 'family', ns, context())).rejects.toThrow('offline')
    expect((await loadHistory(ns)).cursor).toBeNull()
    backend.sync.pull.mockResolvedValueOnce({ records: records.slice(0, 1000), cursor: 'watermark', nextPage: 'page-2' })
      .mockResolvedValueOnce({ records: records.slice(1000), cursor: 'watermark', nextPage: null })
    const result = await syncNow(backend, 'family', ns, context())
    expect(result.data.feeds).toHaveLength(1205)
    expect(result.cursor).toBe('watermark')
    expect(backend.sync.pull.mock.calls[1]).toEqual(['family', null, 'page-2', expect.any(AbortSignal)])
  })

  it('does not persist late responses after identity cancellation', async () => {
    const { backend } = fakeBackend()
    const gate = deferred<{ records: CloudRecord[]; cursor: string; nextPage: null }>()
    backend.sync.pull.mockReturnValueOnce(gate.promise)
    let current = true
    const task = syncNow(backend, 'family', ns, { ...context(), isCurrent: () => current })
    await vi.waitFor(() => expect(backend.sync.pull).toHaveBeenCalled())
    current = false
    gate.resolve({ records: [{ kind: 'feed', record: feed(), version: 'late' }], cursor: 'late', nextPage: null })
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect((await loadHistory(ns)).data.feeds).toEqual([])
  })

  it('rolls back a rejected atomic metadata/data write and preserves retry work', async () => {
    const driver = memoryDriver()
    _setTestDriver(driver)
    await edit(feed())
    const before = await loadHistory(ns)
    _setTestDriver({ ...driver, setItem: () => { throw new Error('quota') } })
    await expect(updateHistory(ns, (state) => {
      state.data.feeds = []
      state.pending = []
      state.cursor = 'must-not-stick'
    })).rejects.toThrow('quota')
    expect(await loadHistory(ns)).toEqual(before)
  })

  it('serializes sync owners across tabs with an atomic expiring lease', async () => {
    const { backend } = fakeBackend()
    await edit(feed())
    const gate = deferred<{ records: CloudRecord[]; cursor: string; nextPage: null }>()
    backend.sync.pull.mockReturnValueOnce(gate.promise)
    const first = syncNow(backend, 'family', ns, context())
    await vi.waitFor(() => expect(backend.sync.pull).toHaveBeenCalledOnce())
    await syncNow(backend, 'family', ns, context())
    expect(backend.sync.pull).toHaveBeenCalledOnce()
    gate.resolve({ records: [], cursor: 'first', nextPage: null })
    await first
    expect((await loadHistory(ns)).syncLease).toBeUndefined()
    expect(backend.sync.push).toHaveBeenCalledOnce()
  })

  it('rejects a previous tab owner after lease takeover even if its network response arrives', async () => {
    const { backend } = fakeBackend()
    const gate = deferred<{ records: CloudRecord[]; cursor: string; nextPage: null }>()
    backend.sync.pull.mockReturnValueOnce(gate.promise)
    const first = syncNow(backend, 'family', ns, context())
    await vi.waitFor(() => expect(backend.sync.pull).toHaveBeenCalledOnce())
    await updateHistory(ns, (state) => { state.syncLease = { id: 'new-owner', until: Date.now() + 30_000 } })
    gate.resolve({ records: [{ kind: 'feed', record: feed(), version: 'stale' }], cursor: 'stale', nextPage: null })
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const stored = await loadHistory(ns)
    expect(stored.data.feeds).toEqual([])
    expect(stored.syncLease?.id).toBe('new-owner')
  })

  it('rejects durable signout in another tab before committing an in-flight response', async () => {
    const { backend } = fakeBackend()
    await writeLocalContext({ revision: 'signed-in' })
    const gate = deferred<{ records: CloudRecord[]; cursor: string; nextPage: null }>()
    backend.sync.pull.mockReturnValueOnce(gate.promise)
    const task = syncNow(backend, 'family', ns, { ...context(), contextRevision: 'signed-in' })
    await vi.waitFor(() => expect(backend.sync.pull).toHaveBeenCalledOnce())
    await writeLocalContext({ revision: 'signed-out' })
    gate.resolve({ records: [{ kind: 'feed', record: feed(), version: 'late' }], cursor: 'late', nextPage: null })
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect((await loadHistory(ns)).data.feeds).toEqual([])
  })

  it('keeps a local-tab alternative when a server delta arrives before resolution', async () => {
    const { backend, rows } = fakeBackend()
    await updateHistory(ns, (state) => {
      state.data.feeds = [feed('same', 200)]
      applyLocalEdit(state, { feeds: [feed('same')], weights: [] }, { feeds: [feed('same', 150)], weights: [] }, true)
    })
    rows.set('feed:same', { kind: 'feed', record: feed('same', 300), version: 'server-now' })
    const result = await syncNow(backend, 'family', ns, context())
    expect(result.conflicts[0]!.remote!.record).toMatchObject({ amount: 200 })
    await resolveStoredConflict(ns, 'feed:same', 'remote', true)
    const again = await syncNow(backend, 'family', ns, context())
    expect(again.conflicts[0]!.local).toMatchObject({ amount: 200 })
    expect(again.conflicts[0]!.remote!.record).toMatchObject({ amount: 300 })
  })

  it('round-trips even empty opaque revision tokens without treating them as absence', async () => {
    await updateHistory(ns, (state) => {
      state.conflicts = [{
        id: 'feed:f1', kind: 'feed', local: feed(),
        remote: { kind: 'feed', record: feed('f1', 200), version: '' }, base: null,
      }]
    })
    const resolved = await resolveStoredConflict(ns, 'feed:f1', 'local', true)
    expect(resolved.pending[0]!.baseVersion).toBe('')
  })
})

describe('versioned offline recovery backups', () => {
  it('round-trips pending edits, tombstones, opaque versions and both conflict alternatives', () => {
    const state = emptyHistory()
    state.data.feeds = [{ ...feed(), deletedAt: '2026-01-02T12:00:00.000Z' }]
    state.pending = [{ mutationId: 'request', kind: 'feed', record: feed('f1', 150), baseVersion: 'opaque' }]
    state.conflicts = [{
      id: 'feed:f1', kind: 'feed', local: feed('f1', 150),
      remote: { kind: 'feed', record: state.data.feeds[0]!, version: 'remote' }, base: null,
    }]
    state.versions['feed:f1'] = state.conflicts[0]!.remote!
    state.cursor = 'opaque-cursor'
    const backup = createBackup(state, { backendId: 'test', namespace: ns })
    expect(parseBackup(backup)).toEqual(state)
  })
  it('imports old exports and strips all non-schema credentials and invitation fields', () => {
    expect(parseBackup({ feeds: [feed()], weights: [] }).data.feeds).toEqual([feed()])
    const backup = createBackup({
      ...emptyHistory(),
      data: { feeds: [{ ...feed(), access_token: 'secret' } as Feed], weights: [] },
      invitation: 'bearer-secret',
    } as ReturnType<typeof emptyHistory>, { backendId: null, namespace: 'guest' })
    expect(JSON.stringify(backup)).not.toContain('secret')
  })
  it('rejects malformed alternatives before restoring anything', () => {
    const backup = createBackup(emptyHistory(), { backendId: null, namespace: 'guest' })
    expect(() => parseBackup({ ...backup, version: 2 })).toThrow('Unsupported')
    expect(() => parseBackup({ ...backup, recovery: { ...backup.recovery, conflicts: [null] } })).toThrow('Invalid')
  })
})
