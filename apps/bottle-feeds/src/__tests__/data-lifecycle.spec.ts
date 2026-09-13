import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { defineComponent, watch } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import memoryDriver from 'unstorage/drivers/memory'
import type { CloudBackend, CloudUser, Family, Mutation } from '../backends/contracts'
import type { Feed } from '../types'

const control = vi.hoisted(() => ({ config: { id: 'test' } as { id: string } | null, factory: vi.fn() }))
vi.mock('../backends', () => ({ get backendConfig() { return control.config }, createBackend: control.factory }))
import { useAppData } from '../composables/useAppData'
import * as storage from '../storage'
import { familyNamespace, emptyContext, type LocalContext, type LocalSelection } from '../sharing/context'
import { applyLocalEdit } from '../sharing/state'

const feed = (id: string, amount = 120): Feed => ({
  id, amount, occurredAt: '2026-09-10T10:00:00.000Z', updatedAt: '2026-09-10T10:00:00.000Z', comment: id,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const sharedFamily: Family = { id: 'family', ownerId: 'a', members: [{ userId: 'a', name: 'A' }] }
const selection = (id = 'a', backendId = 'test'): LocalSelection => ({
  namespace: familyNamespace(backendId, id, 'family'), backendId,
  user: { id }, family: sharedFamily, revoked: false,
})

describe('local-first consent and identity lifecycle', () => {
  let wrapper: ReturnType<typeof mount> | undefined
  let store: ReturnType<typeof useAppData>
  let backend: CloudBackend
  let listeners: Set<(user: CloudUser | null) => void>
  let user: CloudUser | null
  const emit = (next: CloudUser | null) => { user = next; for (const listener of listeners) listener(next) }
  async function start() {
    wrapper = mount(defineComponent({ setup() { store = useAppData(); return () => null } }))
    await flushPromises()
  }
  async function seedContext(patch: Partial<LocalContext> = {}) {
    const selected = selection()
    await storage.writeLocalContext({
      ...emptyContext(), selected, histories: [selected], consentBackend: 'test', ...patch,
    })
    await storage.saveData({ feeds: [feed('cached')], weights: [] }, selected.namespace)
  }
  beforeEach(() => {
    storage._setTestDriver(memoryDriver())
    control.config = { id: 'test' }
    listeners = new Set()
    user = null
    sessionStorage.clear()
    backend = {
      id: 'test',
      auth: {
        restore: vi.fn(async () => user),
        signIn: vi.fn(async () => { emit({ id: 'a' }) }),
        signOut: vi.fn(async () => {}),
        onChange: vi.fn((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
      },
      family: {
        current: vi.fn(async () => sharedFamily), create: vi.fn(async () => sharedFamily),
        invite: vi.fn(async () => ({ token: 'private-token', expiresAt: '2026-09-12T00:00:00.000Z' })),
        revokeInvitation: vi.fn(async () => {}), join: vi.fn(async () => sharedFamily),
        leave: vi.fn(async () => {}), removeMember: vi.fn(async () => {}), delete: vi.fn(async () => {}),
      },
      sync: {
        pull: vi.fn(async () => ({ records: [], cursor: 'opaque', nextPage: null })),
        push: vi.fn(async (_family: string, mutations: Mutation[]) => mutations.map((item) => ({
          mutationId: item.mutationId, status: 'accepted' as const,
          current: { kind: item.kind, record: item.record, version: `accepted:${item.mutationId}` },
        })) as Awaited<ReturnType<CloudBackend['sync']['push']>>),
      },
      dispose: vi.fn(),
    }
    control.factory.mockReset().mockResolvedValue(backend)
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    storage._setTestDriver(null)
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('does not initialize any backend for configured local-only users', async () => {
    await start()
    await store.commit((draft) => { draft.feeds.push(feed('guest')) })
    await store.exportBackup()
    window.dispatchEvent(new Event('online'))
    await store.triggerSync()
    expect(control.factory).not.toHaveBeenCalled()
    expect((await storage.loadData()).feeds).toHaveLength(1)
  })

  it('loads cached history and accepts edits before a stalled auth restore resolves', async () => {
    await seedContext()
    vi.mocked(backend.auth.restore).mockReturnValue(new Promise(() => {}))
    await start()
    expect(store.loading.value).toBe(false)
    expect(store.data.feeds[0]!.id).toBe('cached')
    expect(await store.commit((draft) => { draft.feeds.push(feed('offline')) })).toBe(true)
    expect(store.pendingCount.value).toBe(1)
    expect(backend.sync.push).not.toHaveBeenCalled()
  })

  it('reacts to immediate signIn events without implicitly copying guest history', async () => {
    await storage.saveData({ feeds: [feed('guest')], weights: [] })
    await start()
    await store.signIn('google')
    await flushPromises()
    expect(store.cloudUser.value?.id).toBe('a')
    expect(store.currentNamespace.value).toBe(selection().namespace)
    expect(store.data.feeds).toEqual([])
    expect((await storage.loadData()).feeds[0]!.id).toBe('guest')
    expect(backend.sync.push).not.toHaveBeenCalled()
  })

  it('exposes sharingEnabled to the root synchronous namespace watcher before its guest-copy check', async () => {
    await storage.saveData({ feeds: [feed('guest')], weights: [] })
    await start()
    const transitions: { namespace: string; enabled: boolean; current: boolean }[] = []
    const stop = watch(store.currentNamespace, (namespace) => {
      const identity = store.captureIdentity()
      transitions.push({ namespace, enabled: store.sharingEnabled.value, current: identity.isCurrent() })
    }, { flush: 'sync' })
    await store.signIn('google')
    stop()
    expect(transitions).toEqual([{ namespace: selection().namespace, enabled: true, current: true }])
    expect(backend.sync.push).not.toHaveBeenCalled()
  })

  it('hasLocal reflects only accessible history and never hidden signed-out records', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    expect(store.hasLocal.value).toBe(true)
    await store.signOut()
    expect(store.hasLocal.value).toBe(false)
    await store.commit((draft) => { draft.feeds.push(feed('guest')) })
    expect(store.hasLocal.value).toBe(true)
  })

  it('surfaces rejected cloud actions as string errors without rejecting UI event handlers', async () => {
    await start()
    vi.mocked(backend.family.current).mockResolvedValue(null)
    await store.signIn('google')
    vi.mocked(backend.family.create).mockRejectedValueOnce(new Error('Family service unavailable'))
    await expect(store.createFamily()).resolves.toBeUndefined()
    expect(store.cloudError.value).toBe('Family service unavailable')
    expect(store.cloudBusy.value).toBe(false)
  })

  it('still signs out locally when adapter cleanup and signout throw synchronously', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    vi.mocked(backend.dispose).mockImplementation(() => { throw new Error('Cleanup failed') })
    vi.mocked(backend.auth.signOut).mockImplementation(() => { throw new Error('Remote signout failed') })
    await expect(store.signOut()).resolves.toBeUndefined()
    await flushPromises()
    expect(store.currentNamespace.value).toBe('guest')
    expect(store.data.feeds).toEqual([])
    expect(store.cloudError.value).toBe('Remote signout failed')
    expect((await storage.readLocalContext<LocalContext>())!.signedOut).toBe(true)
  })

  it('holds exclusive deletion and refreshes concurrent durable records without losing recovery metadata', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    await flushPromises()
    const gate = deferred<void>()
    vi.mocked(backend.family.delete).mockReturnValueOnce(gate.promise)
    const deletion = store.deleteFamily()
    await flushPromises()
    expect(store.exclusive.value).toBe(true)
    expect(await store.commit((draft) => { draft.feeds.push(feed('blocked')) })).toBe(false)
    const pulls = vi.mocked(backend.sync.pull).mock.calls.length
    await store.triggerSync()
    expect(backend.sync.pull).toHaveBeenCalledTimes(pulls)
    await storage.mergeDataStrict({ feeds: [feed('other-tab')], weights: [] }, selection().namespace, true)
    const during = await storage.loadHistory(selection().namespace)
    expect(during.syncLease?.id).toMatch(/^delete-/)
    expect(during.pending.map((item) => item.record.id)).toEqual(['other-tab'])
    gate.resolve()
    await deletion
    expect(store.exclusive.value).toBe(false)
    expect(store.data.feeds.map((item) => item.id).sort()).toEqual(['cached', 'other-tab'])
    expect(store.sharingEnabled.value).toBe(false)
    expect((await storage.loadHistory(selection().namespace)).syncLease).toBeUndefined()
  })

  it('releases exclusive deletion on server failure while retaining history and sharing context', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    vi.mocked(backend.family.delete).mockRejectedValueOnce(new Error('Deletion unavailable'))
    await expect(store.deleteFamily()).resolves.toBeUndefined()
    expect(store.exclusive.value).toBe(false)
    expect(store.sharingEnabled.value).toBe(true)
    expect(store.cloudError.value).toBe('Deletion unavailable')
    expect(store.data.feeds.map((item) => item.id)).toEqual(['cached'])
    expect((await storage.loadHistory(selection().namespace)).syncLease).toBeUndefined()
  })

  it('keeps expired-session history editable but stops uploads', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    await flushPromises()
    emit(null)
    await flushPromises()
    expect(store.cloudUser.value).toBeNull()
    expect(store.data.feeds[0]!.id).toBe('cached')
    await store.commit((draft) => { draft.feeds.push(feed('expired')) })
    await store.triggerSync()
    expect(backend.sync.push).not.toHaveBeenCalled()
    expect((await storage.loadHistory(selection().namespace)).pending).toHaveLength(1)
  })

  it('signs out locally while remote signout hangs and retains account-specific pending edits', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    await store.commit((draft) => { draft.feeds.push(feed('pending')) })
    vi.mocked(backend.auth.signOut).mockReturnValue(new Promise(() => {}))
    await store.signOut()
    expect(store.currentNamespace.value).toBe('guest')
    expect(store.data.feeds).toEqual([])
    expect((await storage.loadHistory(selection().namespace)).pending).toHaveLength(1)
    expect((await storage.readLocalContext<LocalContext>())!.signedOut).toBe(true)
    await store.commit((draft) => { draft.feeds.push(feed('new-guest')) })
    expect((await storage.loadHistory('guest')).pending).toEqual([])
    wrapper!.unmount()
    wrapper = undefined
    control.config = null
    await start()
    expect(store.currentNamespace.value).toBe('guest')
    expect(store.data.feeds.map((item) => item.id)).toEqual(['new-guest'])
  })

  it('persists configuration removal and requires explicit resume after restoration', async () => {
    await seedContext()
    control.config = null
    await start()
    expect(store.data.feeds[0]!.id).toBe('cached')
    expect(store.needsResume.value).toBe(true)
    expect(control.factory).not.toHaveBeenCalled()
    await store.commit((draft) => { draft.feeds.push(feed('without-config')) })
    wrapper!.unmount()
    wrapper = undefined
    control.config = { id: 'test' }
    await start()
    expect(store.needsResume.value).toBe(true)
    expect(control.factory).not.toHaveBeenCalled()
    expect(store.pendingCount.value).toBe(1)
    await store.resumeSharing()
    expect(control.factory).toHaveBeenCalledOnce()
  })

  it('never sends an old backend queue to a different backend with matching IDs', async () => {
    await seedContext()
    control.config = { id: 'another-project' }
    await start()
    expect(store.data.feeds[0]!.id).toBe('cached')
    expect(store.needsResume.value).toBe(true)
    await store.resumeSharing()
    expect(store.cloudError.value).toContain('different backend')
    expect(control.factory).not.toHaveBeenCalled()
  })

  it('discards a late pull after signout', async () => {
    await start()
    const pull = deferred<Awaited<ReturnType<CloudBackend['sync']['pull']>>>()
    vi.mocked(backend.sync.pull).mockReturnValue(pull.promise)
    await store.signIn('google')
    await flushPromises()
    expect(backend.sync.pull).toHaveBeenCalled()
    await store.signOut()
    pull.resolve({ records: [{ kind: 'feed', record: feed('late'), version: 'late' }], cursor: 'late', nextPage: null })
    await flushPromises()
    expect(store.data.feeds).toEqual([])
    expect((await storage.loadData('guest')).feeds).toEqual([])
    expect((await storage.loadData(selection().namespace)).feeds).toEqual([])
  })

  it('isolates data when switching to a different normalized account', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    emit({ id: 'b' })
    await flushPromises()
    expect(store.currentNamespace.value).toBe(familyNamespace('test', 'b', 'family'))
    expect(store.data.feeds).toEqual([])
    expect((await storage.loadData(selection().namespace)).feeds[0]!.id).toBe('cached')
  })

  it('preserves failed drafts and explicit retry persists them without claiming prior success', async () => {
    await start()
    const write = vi.spyOn(storage, 'updateHistory').mockRejectedValueOnce(new Error('Quota exceeded'))
    expect(await store.commit((draft) => { draft.feeds.push(feed('unsaved')) })).toBe(false)
    expect(store.data.feeds[0]!.id).toBe('unsaved')
    expect(store.saveError.value).toBe('Quota exceeded')
    expect(await store.flush()).toBe(false)
    await expect(store.exportBackup()).rejects.toThrow('Save')
    write.mockRestore()
    expect(await store.retrySave()).toBe(true)
    expect(store.saveError.value).toBeNull()
    expect((await storage.loadData()).feeds[0]!.id).toBe('unsaved')
  })

  it('keeps concurrent different-record edits from another local tab', async () => {
    await start()
    await storage.updateHistory('guest', (state) => {
      applyLocalEdit(state, { feeds: [], weights: [] }, { feeds: [feed('other-tab')], weights: [] }, false)
    })
    await store.commit((draft) => { draft.feeds.push(feed('this-tab')) })
    expect(store.data.feeds.map((item) => item.id).sort()).toEqual(['other-tab', 'this-tab'])
  })

  it('preserves both same-record local-tab changes as a conflict', async () => {
    await storage.saveData({ feeds: [feed('same')], weights: [] })
    await start()
    await storage.updateHistory('guest', (state) => { state.data.feeds = [feed('same', 200)] })
    await store.commit((draft) => { draft.feeds[0]!.amount = 150 })
    expect(store.conflicts.value[0]!.local).toMatchObject({ amount: 150 })
    expect(store.conflicts.value[0]!.remote!.record).toMatchObject({ amount: 200 })
  })

  it('preserves a removed family as an isolated recovery copy and never recreates it', async () => {
    await seedContext()
    vi.mocked(backend.family.current).mockResolvedValue(null)
    user = { id: 'a' }
    await start()
    await flushPromises()
    expect(store.data.feeds[0]!.id).toBe('cached')
    expect(store.sharingEnabled.value).toBe(false)
    expect(store.cloudError.value).toContain('removed')
    await store.triggerSync()
    await store.createFamily()
    expect(backend.family.create).not.toHaveBeenCalled()
    expect(backend.sync.push).not.toHaveBeenCalled()
  })

  it('keeps invitation tokens through authentication without leaving them in the address', async () => {
    window.history.replaceState(null, '', '/#invite=private-token')
    await start()
    expect(window.location.hash).toBe('')
    expect(store.pendingInvitation.value).toBe(true)
    expect(control.factory).not.toHaveBeenCalled()
    await store.signIn('microsoft')
    await store.acceptInvitation()
    expect(backend.family.join).toHaveBeenCalledWith('private-token')
    expect(store.pendingInvitation.value).toBe(false)
  })

  it('restores legacy exports into an isolated local recovery history without implicit upload', async () => {
    await start()
    await store.signIn('google')
    expect(await store.importBackup({ feeds: [feed('restored')], weights: [] })).toBe(true)
    expect(store.currentNamespace.value).toMatch(/^recovery-/)
    expect(store.data.feeds[0]!.id).toBe('restored')
    expect(store.sharingEnabled.value).toBe(false)
    expect(store.cloudUser.value).toBeNull()
    expect(backend.sync.push).not.toHaveBeenCalled()
    await store.triggerSync()
    expect(backend.sync.push).not.toHaveBeenCalled()
  })

  it('blocks ordinary commits and sync while an exclusive operation is active', async () => {
    await start()
    expect(await store.beginExclusive()).toBe(true)
    expect(await store.commit((draft) => { draft.feeds.push(feed('blocked')) })).toBe(false)
    store.endExclusive()
    expect(await store.commit((draft) => { draft.feeds.push(feed('allowed')) })).toBe(true)
  })

  it('does not duplicate queued mutations when rapid saves overlap', async () => {
    await seedContext()
    vi.mocked(backend.auth.restore).mockReturnValue(new Promise(() => {}))
    await start()
    await Promise.all([
      store.commit((draft) => { draft.feeds.push(feed('one')) }),
      store.commit((draft) => { draft.feeds.push(feed('two')) }),
      store.commit((draft) => { draft.feeds.push(feed('three')) }),
    ])
    const saved = await storage.loadHistory(selection().namespace)
    expect(saved.pending.map((item) => item.record.id)).toEqual(['one', 'two', 'three'])
    expect(saved.data.feeds).toHaveLength(4)
  })

  it('does not reload or repeatedly publish unchanged context on token refresh', async () => {
    await seedContext()
    user = { id: 'a' }
    await start()
    await flushPromises()
    const identity = store.captureIdentity()
    const saved = await storage.readLocalContext<LocalContext>()
    emit({ id: 'a' })
    await flushPromises()
    expect(store.captureIdentity().namespace).toBe(identity.namespace)
    expect(identity.isCurrent()).toBe(true)
    expect((await storage.readLocalContext<LocalContext>())!.revision).toBe(saved!.revision)
  })

  it('rejects a late membership response belonging to a previous account', async () => {
    await start()
    const late = deferred<Family | null>()
    vi.mocked(backend.family.current).mockReturnValueOnce(late.promise)
    const signingIn = store.signIn('google')
    await flushPromises()
    emit({ id: 'b' })
    await flushPromises()
    late.resolve(sharedFamily)
    await signingIn
    await flushPromises()
    expect(store.cloudUser.value?.id).toBe('b')
    expect(store.currentNamespace.value).toBe(familyNamespace('test', 'b', 'family'))
    expect((await storage.readLocalContext<LocalContext>())!.selected!.user!.id).toBe('b')
  })

  it('restores known conflict alternatives offline and resolves them without a backend', async () => {
    control.config = null
    await start()
    const incoming = {
      format: 'little-sips-backup', version: 1, records: { feeds: [feed('conflicted')], weights: [] },
      recovery: {
        pending: [], versions: {}, cursor: 'untrusted',
        conflicts: [{
          id: 'feed:conflicted', kind: 'feed', local: feed('conflicted', 100),
          remote: { kind: 'feed', record: feed('conflicted', 200), version: 'remote' }, base: null,
        }],
      },
    }
    expect(await store.importBackup(incoming)).toBe(true)
    expect(store.conflicts.value).toHaveLength(1)
    await store.resolveConflict('feed:conflicted', 'remote')
    expect(store.data.feeds[0]!.amount).toBe(200)
    expect(store.conflicts.value).toEqual([])
    expect(control.factory).not.toHaveBeenCalled()
  })
})
