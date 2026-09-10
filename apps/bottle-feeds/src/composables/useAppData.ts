import { onMounted, onUnmounted, reactive, ref, shallowReadonly, watch } from 'vue'
import { activeNamespace, authUser, initAuth } from '../auth'
import { mergeAppData } from '../merge'
import { isSupabaseConfigured } from '../supabase'
import { GUEST_NAMESPACE, loadData, mergeDataStrict, isDirty, type Namespace } from '../storage'
import { resetSyncState, syncNow, syncStatus } from '../sync'
import type { AppData } from '../types'

const emptyData = (): AppData => ({ feeds: [], weights: [] })
const cloneData = (data: AppData): AppData => ({
  feeds: data.feeds.map((feed) => ({ ...feed })),
  weights: data.weights.map((weight) => ({ ...weight })),
})

/** Owns all hydration, persistence and synchronization for one active identity. */
export function useAppData() {
  const data = reactive<AppData>(emptyData())
  const currentNamespace = ref<Namespace>(GUEST_NAMESPACE)
  const loading = ref(true)
  const loadError = ref<string | null>(null)
  const saveError = ref<string | null>(null)
  const saving = ref(false)
  const exclusive = ref(false)
  let generation = 0
  let revision = 0
  let stateVersion = 0
  const pendingDrafts = new Map<
    Namespace,
    {
      data: AppData
      revision: number
      error: string | null
    }
  >()
  let started = false
  let disposed = false
  let saveQueue: Promise<void> = Promise.resolve()
  let syncTask: Promise<void> | null = null
  let syncController = new AbortController()
  let channel: BroadcastChannel | undefined

  function apply(snapshot: AppData) {
    stateVersion++
    data.feeds = snapshot.feeds
    data.weights = snapshot.weights
  }

  function captureIdentity() {
    const capturedGeneration = generation
    const namespace = currentNamespace.value
    const userId = authUser.value?.id
    return {
      namespace,
      userId,
      isCurrent: () =>
        !disposed &&
        generation === capturedGeneration &&
        currentNamespace.value === namespace &&
        activeNamespace.value === namespace &&
        authUser.value?.id === userId,
    }
  }

  function notifyOtherTabs(namespace: Namespace) {
    channel?.postMessage({ namespace })
  }

  async function commit(update: (draft: AppData) => void): Promise<boolean> {
    const identity = captureIdentity()
    if (loading.value || loadError.value || exclusive.value || !identity.isCurrent()) return false
    const snapshot = cloneData(data)
    update(snapshot)
    apply(snapshot)
    const operationRevision = ++revision
    pendingDrafts.set(identity.namespace, {
      data: cloneData(snapshot),
      revision: operationRevision,
      error: null,
    })
    saving.value = true
    if (identity.userId && syncStatus.value !== 'syncing') syncStatus.value = 'pending'
    const operation = saveQueue.then(async () => {
      try {
        const stored = await mergeDataStrict(snapshot, identity.namespace, Boolean(identity.userId))
        if (pendingDrafts.get(identity.namespace)?.revision === operationRevision)
          pendingDrafts.delete(identity.namespace)
        notifyOtherTabs(identity.namespace)
        if (identity.isCurrent()) {
          // Later UI mutations are not necessarily on disk yet.
          apply(operationRevision === revision ? stored : mergeAppData(cloneData(data), stored))
          saveError.value = null
        }
        return identity.isCurrent()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const retained = pendingDrafts.get(identity.namespace)
        if (retained && retained.revision === operationRevision) retained.error = message
        if (identity.isCurrent()) saveError.value = message
        return false
      } finally {
        if (identity.isCurrent() && operationRevision === revision) saving.value = false
      }
    })
    saveQueue = operation.then(() => undefined)
    return operation
  }

  const retrySave = () => commit(() => {})

  async function flush(): Promise<boolean> {
    const identity = captureIdentity()
    await saveQueue
    return identity.isCurrent() && !saveError.value
  }

  function cancelSync() {
    syncController.abort()
    syncController = new AbortController()
    syncTask = null
    if (syncStatus.value === 'syncing') syncStatus.value = 'pending'
  }

  async function beginExclusive(): Promise<boolean> {
    if (exclusive.value) return false
    const identity = captureIdentity()
    exclusive.value = true
    cancelSync()
    const ready = await flush()
    if (!ready && identity.isCurrent()) exclusive.value = false
    return ready
  }

  function endExclusive() {
    exclusive.value = false
  }

  function triggerSync(): Promise<void> {
    if (syncTask) return syncTask
    const identity = captureIdentity()
    if (
      !identity.userId ||
      loading.value ||
      loadError.value ||
      exclusive.value ||
      !isSupabaseConfigured
    )
      return Promise.resolve()
    const userId = identity.userId
    const signal = syncController.signal
    const task = (async () => {
      if (!(await flush()) || !identity.isCurrent() || signal.aborted) return
      const syncedRevision = revision
      try {
        const merged = await syncNow(userId, identity.namespace, cloneData(data), {
          isCurrent: identity.isCurrent,
          signal,
        })
        if (!identity.isCurrent() || signal.aborted) return
        apply(revision === syncedRevision ? merged : mergeAppData(cloneData(data), merged))
        if (revision !== syncedRevision) syncStatus.value = 'pending'
        notifyOtherTabs(identity.namespace)
      } catch {
        // syncNow exposes failures in the active identity's sync status.
      }
    })()
    syncTask = task
    void task.finally(() => {
      if (syncTask === task) syncTask = null
    })
    return task
  }

  async function loadCurrent() {
    started = true
    generation++
    cancelSync()
    resetSyncState()
    currentNamespace.value = activeNamespace.value
    const identity = captureIdentity()
    loading.value = true
    loadError.value = null
    saveError.value = null
    saving.value = false
    exclusive.value = false
    apply(emptyData())
    try {
      await saveQueue
      if (!identity.isCurrent()) return
      const loaded = await loadData(identity.namespace)
      const pending = identity.userId ? await isDirty(identity.namespace) : false
      if (!identity.isCurrent()) return
      const retained = pendingDrafts.get(identity.namespace)
      apply(retained ? mergeAppData(loaded, retained.data) : loaded)
      saveError.value = retained?.error ?? null
      if (pending) syncStatus.value = 'pending'
    } catch (error) {
      if (identity.isCurrent())
        loadError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (identity.isCurrent()) loading.value = false
    }
    if (identity.isCurrent() && !loadError.value && navigator.onLine) void triggerSync()
  }

  watch(
    activeNamespace,
    () => {
      void loadCurrent()
    },
    { flush: 'sync' },
  )

  async function refreshFromStorage() {
    const identity = captureIdentity()
    if (loading.value || loadError.value || exclusive.value) return
    try {
      await saveQueue
      if (!identity.isCurrent() || exclusive.value) return
      const capturedVersion = stateVersion
      const stored = await loadData(identity.namespace)
      const pending = identity.userId ? await isDirty(identity.namespace) : false
      if (!identity.isCurrent() || exclusive.value) return
      apply(
        capturedVersion === stateVersion && !saving.value && !saveError.value
          ? stored
          : mergeAppData(cloneData(data), stored),
      )
      if (pending && syncStatus.value !== 'syncing') syncStatus.value = 'pending'
    } catch (error) {
      if (identity.isCurrent())
        saveError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const handleOnline = () => {
    void triggerSync()
  }
  const handleFocus = () => {
    void refreshFromStorage()
  }
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!saving.value && !saveError.value && pendingDrafts.size === 0) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(async () => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('little-sips-data')
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (
          typeof event.data === 'object' &&
          event.data !== null &&
          'namespace' in event.data &&
          event.data.namespace === currentNamespace.value
        )
          void refreshFromStorage()
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)
    try {
      await initAuth()
      if (!started && !disposed) await loadCurrent()
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error)
      loading.value = false
    }
  })

  onUnmounted(() => {
    disposed = true
    generation++
    cancelSync()
    channel?.close()
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('beforeunload', handleBeforeUnload)
  })

  return {
    data: shallowReadonly(data),
    currentNamespace,
    loading,
    loadError,
    saveError,
    saving,
    exclusive,
    commit,
    retrySave,
    flush,
    triggerSync,
    cancelSync,
    beginExclusive,
    endExclusive,
    captureIdentity,
    reload: loadCurrent,
  }
}
