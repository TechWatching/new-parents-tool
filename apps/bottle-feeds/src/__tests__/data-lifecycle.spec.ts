import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import memoryDriver from 'unstorage/drivers/memory'
import type { AppData, Feed } from '../types'

const remote = vi.hoisted(() => ({
  pullAll: vi.fn<() => Promise<AppData>>(),
  pushFeeds: vi.fn<() => Promise<void>>(),
  pushWeights: vi.fn<() => Promise<void>>(),
}))
const authControl = vi.hoisted(() => ({ setUser: vi.fn<(id: string | null) => void>() }))
vi.mock('../remote', () => remote)
vi.mock('../supabase', () => ({ isSupabaseConfigured: true }))
vi.mock('../auth', async () => {
  const { computed, ref } = await import('vue')
  const authUser = ref<{ id: string } | null>(null)
  authControl.setUser.mockImplementation((id) => {
    authUser.value = id ? { id } : null
  })
  return {
    authUser,
    activeNamespace: computed(() => (authUser.value ? `user-${authUser.value.id}` : 'guest')),
    initAuth: vi.fn(async () => null),
  }
})

import { useAppData } from '../composables/useAppData'
import * as storage from '../storage'
import { syncStatus, resetSyncState } from '../sync'

const feed = (id: string): Feed => ({
  id,
  amount: 120,
  occurredAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
  comment: id,
})
const signIn = (id: string) => authControl.setUser(id)
const cloudData: AppData = { feeds: [feed('cloud')], weights: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('identity-scoped data lifecycle', () => {
  let wrapper: ReturnType<typeof mount> | undefined
  let store: ReturnType<typeof useAppData>

  beforeEach(async () => {
    authControl.setUser(null)
    storage._setTestDriver(memoryDriver())
    resetSyncState()
    remote.pullAll.mockReset().mockResolvedValue(cloudData)
    remote.pushFeeds.mockReset().mockResolvedValue()
    remote.pushWeights.mockReset().mockResolvedValue()
    wrapper = mount(
      defineComponent({
        setup() {
          store = useAppData()
          return () => null
        },
      }),
    )
    await flushPromises()
  })

  afterEach(() => {
    wrapper?.unmount()
    storage._setTestDriver(null)
    vi.restoreAllMocks()
  })

  it('does not apply a late sync result to the guest identity', async () => {
    const push = deferred<void>()
    remote.pushFeeds.mockReturnValue(push.promise)
    signIn('a')
    await flushPromises()
    expect(remote.pushFeeds).toHaveBeenCalledOnce()
    authControl.setUser(null)
    await flushPromises()
    push.resolve()
    await flushPromises()
    expect(store.data.feeds).toEqual([])
    expect((await storage.loadData('guest')).feeds).toEqual([])
    expect(syncStatus.value).toBe('idle')
  })

  it('keeps edits made during sync and leaves them pending', async () => {
    const push = deferred<void>()
    remote.pushFeeds.mockReturnValue(push.promise)
    signIn('a')
    await flushPromises()
    expect(remote.pushFeeds).toHaveBeenCalledOnce()
    await store.commit((draft) => {
      draft.feeds.push(feed('new'))
    })
    push.resolve()
    await flushPromises()
    expect(store.data.feeds.map((item) => item.id).sort()).toEqual(['cloud', 'new'])
    expect((await storage.loadData('user-a')).feeds).toHaveLength(2)
    expect(await storage.isDirty('user-a')).toBe(true)
    expect(syncStatus.value).toBe('pending')
  })

  it('does not mark hydration or a successful sync as a new local edit', async () => {
    signIn('a')
    await flushPromises()
    expect(store.data.feeds).toEqual(cloudData.feeds)
    expect(syncStatus.value).toBe('synced')
    expect(await storage.isDirty('user-a')).toBe(false)
  })

  it('retains failed mutations for an explicit retry without claiming they were saved', async () => {
    const save = vi
      .spyOn(storage, 'mergeDataStrict')
      .mockRejectedValueOnce(new Error('Quota exceeded'))
    expect(
      await store.commit((draft) => {
        draft.feeds.push(feed('unsaved'))
      }),
    ).toBe(false)
    expect(store.saveError.value).toBe('Quota exceeded')
    expect(store.data.feeds).toHaveLength(1)
    expect((await storage.loadData()).feeds).toHaveLength(0)
    expect(await store.flush()).toBe(false)
    save.mockRestore()
    expect(await store.retrySave()).toBe(true)
    expect(store.saveError.value).toBeNull()
    expect((await storage.loadData()).feeds[0]?.id).toBe('unsaved')
  })

  it('rejects late namespace loads after switching accounts', async () => {
    const load = deferred<AppData>()
    const loadSpy = vi.spyOn(storage, 'loadData')
    loadSpy.mockImplementationOnce(() => load.promise)
    signIn('a')
    await flushPromises()
    expect(loadSpy).toHaveBeenCalledWith('user-a')
    authControl.setUser(null)
    await flushPromises()
    load.resolve(cloudData)
    await flushPromises()
    expect(store.currentNamespace.value).toBe('guest')
    expect(store.data.feeds).toEqual([])
    expect(remote.pullAll).not.toHaveBeenCalled()
  })

  it('restores failed drafts only when their owning identity becomes active again', async () => {
    vi.spyOn(storage, 'mergeDataStrict').mockRejectedValueOnce(new Error('Quota exceeded'))
    await store.commit((draft) => {
      draft.feeds.push(feed('guest-draft'))
    })
    signIn('a')
    await flushPromises()
    expect(store.data.feeds.map((item) => item.id)).toEqual(['cloud'])
    expect(store.saveError.value).toBeNull()
    authControl.setUser(null)
    await flushPromises()
    expect(store.data.feeds.map((item) => item.id)).toEqual(['guest-draft'])
    expect(store.saveError.value).toBe('Quota exceeded')
    expect((await storage.loadData('user-a')).feeds.map((item) => item.id)).toEqual(['cloud'])
    expect(await store.retrySave()).toBe(true)
    expect((await storage.loadData('guest')).feeds.map((item) => item.id)).toEqual(['guest-draft'])
  })

  it('waits for pending writes before refreshing on focus', async () => {
    const gate = deferred<void>()
    const merge = storage.mergeDataStrict
    vi.spyOn(storage, 'mergeDataStrict').mockImplementationOnce(async (...args) => {
      await gate.promise
      return merge(...args)
    })
    const load = vi.spyOn(storage, 'loadData')
    const saved = store.commit((draft) => {
      draft.feeds.push(feed('new'))
    })
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(load).not.toHaveBeenCalled()
    gate.resolve()
    await saved
    await flushPromises()
    expect(store.data.feeds.map((item) => item.id)).toEqual(['new'])
  })

  it('blocks mutations and new syncs during an exclusive operation', async () => {
    signIn('a')
    await flushPromises()
    remote.pullAll.mockClear()
    expect(await store.beginExclusive()).toBe(true)
    expect(
      await store.commit((draft) => {
        draft.feeds.push(feed('blocked'))
      }),
    ).toBe(false)
    await store.triggerSync()
    expect(remote.pullAll).not.toHaveBeenCalled()
    expect(store.data.feeds.map((item) => item.id)).toEqual(['cloud'])
    store.endExclusive()
    expect(
      await store.commit((draft) => {
        draft.feeds.push(feed('allowed'))
      }),
    ).toBe(true)
  })
})
