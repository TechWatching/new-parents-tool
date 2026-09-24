import { computed, onMounted, onUnmounted, reactive, ref, shallowReadonly, shallowRef } from 'vue'
import { backendConfig, createBackend } from '../backends'
import { BackendError, type CloudBackend, type CloudUser, type Family, type Invitation, type SignInProvider } from '../backends/contracts'
import { observeAuth, signInWithProvider } from '../auth'
import { createBackup, parseBackup } from '../backup'
import { mergeAppData } from '../merge'
import {
  GUEST_NAMESPACE, loadHistory, mergeDataStrict, updateHistory, readLocalContext, writeLocalContext,
  type Namespace,
} from '../storage'
import {
  captureInvitation, emptyContext, familyNamespace, forgetInvitation,
  type LocalContext, type LocalSelection,
} from '../sharing/context'
import {
  applyLocalEdit, cloneHistory, emptyHistory, putRecord, recordKey, sameRecord,
  type HistoryState, type SyncConflict,
} from '../sharing/state'
import { resetSyncState, resolveStoredConflict, syncError, syncNow, syncStatus } from '../sync'
import { parseAppData } from '../validation'
import type { AppData } from '../types'
import { cloudRequest } from '../sharing/request'

/** Local history is ready before any optional authentication request starts. */
export function useAppData() {
  const data = reactive<AppData>({ feeds: [], weights: [] })
  const currentNamespace = shallowRef<Namespace>(GUEST_NAMESPACE)
  const loading = shallowRef(true)
  const loadError = shallowRef<string | null>(null)
  const saveError = shallowRef<string | null>(null)
  const saving = shallowRef(false)
  const exclusive = shallowRef(false)
  const cloudUser = ref<CloudUser | null>(null)
  const family = ref<Family | null>(null)
  const cloudBusy = shallowRef(false)
  const cloudError = shallowRef<string | null>(null)
  const invitation = ref<Invitation | null>(null)
  const pendingInvitation = shallowRef(false)
  const pendingCount = shallowRef(0)
  const conflicts = ref<SyncConflict[]>([])
  const hasLocal = computed(() => Boolean(
    data.feeds.length || data.weights.length || pendingCount.value || conflicts.value.length,
  ))
  const context = ref<LocalContext>(emptyContext())
  const backendAvailable = Boolean(backendConfig)
  const pendingImportNamespace = computed(() =>
    !context.value.pendingImportUserId || context.value.pendingImportUserId === cloudUser.value?.id
      ? context.value.pendingImportNamespace ?? null : null)
  const needsResume = computed(() => !context.value.signedOut && (
    context.value.suspended ||
    Boolean(context.value.selected?.backendId && context.value.selected.backendId !== backendConfig?.id)
  ))
  const sharingEnabled = computed(() => Boolean(
    backendConfig && context.value.consentBackend === backendConfig.id &&
    !context.value.signedOut && !context.value.suspended &&
    context.value.selected?.backendId === backendConfig.id &&
    context.value.selected.namespace === currentNamespace.value &&
    context.value.selected.family && !context.value.selected.revoked,
  ))
  let disposed = false
  let generation = 0
  let authGeneration = 0
  let revision = 0
  let backend: CloudBackend | null = null
  let backendTask: Promise<CloudBackend | null> | null = null
  let stopAuth: (() => void) | undefined
  let stopSubscription: (() => void) | undefined
  let authTask: Promise<void> = Promise.resolve()
  let saveQueue: Promise<void> = Promise.resolve()
  let contextQueue: Promise<void> = Promise.resolve()
  let syncTask: Promise<void> | null = null
  let syncController = new AbortController()
  let channel: BroadcastChannel | undefined
  let editTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let pendingToken: string | null = null
  let retryFailures = 0
  const drafts = new Map<Namespace, { before: AppData; after: AppData; revision: number; error: string | null }>()

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  const isAuthenticationChange = (error: unknown) =>
    error instanceof BackendError && error.code === 'auth' && error.message === 'Authentication changed'
  const snapshot = () => cloneHistory({ feeds: data.feeds, weights: data.weights })
  function apply(state: HistoryState, records = true) {
    if (records) {
      data.feeds = state.data.feeds
      data.weights = state.data.weights
    }
    pendingCount.value = state.pending.length
    conflicts.value = state.conflicts
  }
  function captureIdentity() {
    const captured = generation
    const namespace = currentNamespace.value
    const userId = !context.value.signedOut && context.value.selected?.namespace === namespace
      ? context.value.selected.user?.id : undefined
    return { namespace, userId, isCurrent: () => !disposed && captured === generation && currentNamespace.value === namespace }
  }
  function notify(namespace: Namespace) { channel?.postMessage({ namespace }) }
  async function persistContext(next: LocalContext, isCurrent: () => boolean = () => !disposed) {
    if (sameRecord({ ...next, revision: '' }, { ...context.value, revision: '' })) return
    const value = cloneHistory({ ...next, revision: crypto.randomUUID() })
    const operation = contextQueue.then(async () => {
      await writeLocalContext(value, isCurrent)
      if (isCurrent()) context.value = value
      channel?.postMessage({ context: true })
    })
    contextQueue = operation.catch(() => {})
    await operation
  }
  function cancelSync() {
    syncController.abort()
    syncController = new AbortController()
    syncTask = null
    clearTimeout(editTimer)
    if (syncStatus.value === 'syncing') syncStatus.value = 'pending'
  }
  function stopCloud(options: { preserveUser?: boolean } = {}) {
    const user = options.preserveUser ? cloudUser.value : null
    authGeneration++
    cancelSync()
    cleanupCloud(stopSubscription)
    stopSubscription = undefined
    cleanupCloud(stopAuth)
    stopAuth = undefined
    if (backend) cleanupCloud(() => backend!.dispose())
    backend = null
    backendTask = null
    cloudUser.value = user
    invitation.value = null
  }
  function cleanupCloud(cleanup?: () => void) {
    try { cleanup?.() } catch (error) { cloudError.value = message(error) }
  }
  function scheduleSync(delay = 600) {
    clearTimeout(editTimer)
    const retryDelay = retryFailures ? Math.min(60_000, 1000 * 2 ** Math.min(retryFailures, 6)) : 0
    if (sharingEnabled.value) editTimer = setTimeout(() => { void triggerSync() }, Math.max(delay, retryDelay))
  }

  async function commit(update: (draft: AppData) => void): Promise<boolean> {
    const identity = captureIdentity()
    if (loading.value || loadError.value || exclusive.value) return false
    const before = snapshot()
    const after = cloneHistory(before)
    try { update(after); parseAppData(after) } catch (error) { saveError.value = message(error); return false }
    const retained = drafts.get(identity.namespace)
    const baseline = retained?.before ?? before
    const operationRevision = ++revision
    drafts.set(identity.namespace, { before: baseline, after, revision: operationRevision, error: null })
    data.feeds = after.feeds
    data.weights = after.weights
    saving.value = true
    // A suspended family still accumulates recoverable work, but no network work.
    const shared = Boolean(!context.value.signedOut &&
      context.value.selected?.namespace === identity.namespace &&
      context.value.selected.backendId && context.value.selected.family)
    const operation = saveQueue.then(async () => {
      try {
        const state = await updateHistory(identity.namespace, (state) => {
          applyLocalEdit(state, baseline, after, shared)
        })
        if (drafts.get(identity.namespace)?.revision === operationRevision) drafts.delete(identity.namespace)
        notify(identity.namespace)
        if (identity.isCurrent()) {
          if (operationRevision === revision) apply(state)
          else {
            // Only replay edits not yet persisted; remote authority never goes
            // through the legacy timestamp merge.
            const latest = snapshot()
            applyLocalEdit(state, after, latest, false)
            apply(state)
          }
          saveError.value = null
          if (shared && syncStatus.value !== 'syncing') syncStatus.value = 'pending'
          scheduleSync()
        }
        return identity.isCurrent()
      } catch (error) {
        const draft = drafts.get(identity.namespace)
        if (draft) draft.error = message(error)
        if (identity.isCurrent()) saveError.value = message(error)
        return false
      } finally {
        if (identity.isCurrent() && operationRevision === revision) saving.value = false
      }
    })
    saveQueue = operation.then(() => undefined)
    return operation
  }
  const retrySave = () => commit(() => {})
  async function flush() {
    const identity = captureIdentity()
    await saveQueue
    return identity.isCurrent() && !saveError.value && !drafts.has(identity.namespace)
  }
  async function beginExclusive() {
    if (exclusive.value) return false
    exclusive.value = true
    cancelSync()
    const ready = await flush()
    if (!ready) exclusive.value = false
    return ready
  }
  function endExclusive() { exclusive.value = false }

  async function loadCurrent() {
    generation++
    cancelSync()
    resetSyncState()
    const selected = context.value.signedOut ? null : context.value.selected
    family.value = selected?.family ?? null
    currentNamespace.value = selected?.namespace ?? GUEST_NAMESPACE
    const identity = captureIdentity()
    loading.value = true
    loadError.value = null
    saveError.value = null
    saving.value = false
    apply(emptyHistory())
    try {
      await saveQueue
      const state = await loadHistory(identity.namespace)
      if (!identity.isCurrent()) return
      const draft = drafts.get(identity.namespace)
      if (draft) {
        applyLocalEdit(state, draft.before, draft.after, false)
        saveError.value = draft.error
      }
      apply(state)
      if (state.pending.length || state.conflicts.length) syncStatus.value = 'pending'
    } catch (error) {
      if (identity.isCurrent()) loadError.value = message(error)
    } finally {
      if (identity.isCurrent()) loading.value = false
    }
  }
  async function refreshFromStorage() {
    const identity = captureIdentity()
    if (loading.value || exclusive.value) return
    await saveQueue
    if (!identity.isCurrent()) return
    const capturedRevision = revision
    try {
      const state = await loadHistory(identity.namespace)
      if (!identity.isCurrent()) return
      if (capturedRevision === revision && !drafts.has(identity.namespace)) apply(state)
      else apply(state, false)
    } catch (error) {
      if (identity.isCurrent()) saveError.value = message(error)
    }
  }
  async function selectFamily(nextFamily: Family, user: CloudUser, client: CloudBackend) {
    const epoch = authGeneration
    const valid = () => !disposed && backend === client && cloudUser.value?.id === user.id && epoch === authGeneration
    if (!valid()) return
    const selection: LocalSelection = {
      namespace: familyNamespace(client.id, user.id, nextFamily.id), backendId: client.id,
      user, family: nextFamily, revoked: false,
    }
    const previousNamespace = currentNamespace.value
    await persistContext({
      ...context.value, selected: selection, signedOut: false, suspended: false,
      histories: [...context.value.histories.filter((item) => item.namespace !== selection.namespace), selection],
    }, valid)
    if (!valid()) return
    if (previousNamespace !== selection.namespace || loading.value || loadError.value) await loadCurrent()
    else family.value = nextFamily
    subscribe()
    void triggerSync()
  }
  async function isolateFamily(reason: string) {
    cancelSync()
    cleanupCloud(stopSubscription)
    stopSubscription = undefined
    cloudError.value = reason
    const selection = context.value.selected
    if (selection?.family) {
      // Keep the family in history for recovery, but clear it from the active
      // selection. The UI must not offer destructive actions for a family the
      // user has left or deleted.
      const revoked = { ...selection, revoked: true }
      const active = { ...revoked, family: null }
      await persistContext({
        ...context.value, selected: active, suspended: true,
        histories: [...context.value.histories.filter((item) => item.namespace !== revoked.namespace), revoked],
      })
      family.value = null
    }
  }
  async function retainFamilyOnDevice() {
    const selection = context.value.selected
    if (!selection || selection.backendId !== backend?.id || selection.user?.id !== cloudUser.value?.id) {
      throw new Error('The active family changed')
    }
    const identity = captureIdentity()
    const history = await loadHistory(selection.namespace)
    if (!identity.isCurrent()) return
    await mergeDataStrict({
      feeds: history.data.feeds.filter((row) => !row.deletedAt),
      weights: history.data.weights.filter((row) => !row.deletedAt),
    }, GUEST_NAMESPACE)
    if (!identity.isCurrent()) return
    const retained = { ...selection, revoked: true }
    cancelSync()
    cleanupCloud(stopSubscription)
    stopSubscription = undefined
    await persistContext({
      ...context.value, selected: null, suspended: false,
      histories: [...context.value.histories.filter((item) => item.namespace !== retained.namespace), retained],
    }, identity.isCurrent)
    if (identity.isCurrent()) await loadCurrent()
  }
  function subscribe() {
    cleanupCloud(stopSubscription)
    stopSubscription = undefined
    if (backend && sharingEnabled.value && cloudUser.value && family.value && document.visibilityState !== 'hidden') {
      try {
        stopSubscription = backend.sync.subscribe?.(family.value.id, () => scheduleSync())
      } catch (error) { cloudError.value = message(error) }
    }
  }
  function triggerSync(): Promise<void> {
    if (syncTask) return syncTask
    const client = backend
    const selected = context.value.selected
    if (!client || !sharingEnabled.value || !cloudUser.value || !selected?.family ||
      selected.user?.id !== cloudUser.value.id || loading.value || loadError.value ||
      exclusive.value || !navigator.onLine) return Promise.resolve()
    const identity = captureIdentity()
    const capturedAuth = authGeneration
    const signal = syncController.signal
    const valid = () => identity.isCurrent() && capturedAuth === authGeneration &&
      backend === client && sharingEnabled.value && cloudUser.value?.id === selected.user?.id
    const task = (async () => {
      if (!(await flush()) || !valid()) return
      try {
        const membership = await cloudRequest(() => client.family.current(), signal)
        if (!valid() || signal.aborted) return
        if (!membership || membership.id !== selected.family!.id) {
          await isolateFamily('Family access was removed. Your local history is retained for recovery.')
          return
        }
        if (JSON.stringify(membership) !== JSON.stringify(selected.family)) {
          const nextSelection = { ...selected, family: membership }
          await persistContext({
            ...context.value,
            selected: nextSelection,
            histories: context.value.histories.map(item =>
              item.namespace === nextSelection.namespace ? nextSelection : item),
          }, valid)
          if (!valid()) return
          family.value = membership
        }
        if (membership.members.length >= 2) invitation.value = null
        else if (invitation.value) scheduleSync(2_000)
        const state = await syncNow(client, membership.id, identity.namespace, {
          isCurrent: valid, signal, contextRevision: context.value.revision,
        })
        if (!valid() || signal.aborted) return
        retryFailures = 0
        // Always re-read after the request: a local save may have completed
        // after the receipt transaction, or still be waiting to persist.
        await saveQueue
        if (valid()) await refreshFromStorage()
        notify(identity.namespace)
        const blocked = new Set(state.conflicts.map((item) => item.id))
        if (state.pending.some((item) => !blocked.has(recordKey(item.kind, item.record.id)))) scheduleSync(800)
      } catch (error) {
        if (!valid() || signal.aborted) return
        if (isAuthenticationChange(error)) {
          syncError.value = null
          syncStatus.value = 'idle'
          return
        }
        cloudError.value = message(error)
        if (error instanceof BackendError && error.code === 'auth') {
          cloudUser.value = null
          cleanupCloud(stopSubscription)
        }
        if (error instanceof BackendError && error.code === 'forbidden') await isolateFamily(message(error))
        else if (!(error instanceof BackendError) || error.code === 'transient') {
          retryFailures++
          if (document.visibilityState !== 'hidden') scheduleSync()
        }
      }
    })().catch((error: unknown) => {
      if (identity.isCurrent()) cloudError.value = message(error)
    })
    syncTask = task
    void task.finally(() => { if (syncTask === task) syncTask = null })
    return task
  }

  async function handleUser(user: CloudUser | null, client: CloudBackend, epoch: number) {
    if (disposed || backend !== client || authGeneration !== epoch || context.value.signedOut) return
    cloudUser.value = user
    cancelSync()
    cleanupCloud(stopSubscription)
    stopSubscription = undefined
    if (!user) return // Expiration is not explicit local sign-out.
    const valid = () => !disposed && backend === client && authGeneration === epoch && cloudUser.value?.id === user.id
    const previous = context.value.selected
    if (previous?.backendId && (previous.backendId !== client.id || previous.user?.id !== user.id)) {
      generation++
      apply(emptyHistory())
      await persistContext({ ...context.value, selected: null }, valid)
      if (!valid()) return
      await loadCurrent()
    }
    try {
      const membership = await cloudRequest(() => client.family.current())
      if (disposed || backend !== client || authGeneration !== epoch || cloudUser.value?.id !== user.id) return
      if (membership) {
        await selectFamily(membership, user, client)
      } else {
        const retained = context.value.histories.find((item) => item.namespace === context.value.selected?.namespace &&
          item.backendId === client.id && item.user?.id === user.id)
        if (retained) {
          await persistContext({ ...context.value, selected: { ...retained, revoked: true } }, valid)
          if (!valid()) return
          await loadCurrent()
          await isolateFamily('Family access was removed. Your local history is retained for recovery.')
        }
      }
    } catch (error) {
      if (valid()) {
        cloudError.value = message(error)
        if (error instanceof BackendError && error.code === 'forbidden') await isolateFamily(message(error))
        if (error instanceof BackendError && error.code === 'auth') cloudUser.value = null
      }
    }
  }
  async function ensureBackend() {
    if (!backendConfig || context.value.consentBackend !== backendConfig.id || context.value.suspended || context.value.signedOut) return null
    if (backend) return backend
    if (backendTask) return backendTask
    const epoch = authGeneration
    backendTask = (async () => {
      const client = await createBackend()
      if (disposed || authGeneration !== epoch) { client?.dispose(); return null }
      if (!client || client.id !== backendConfig.id) { client?.dispose(); throw new Error('Backend identity mismatch') }
      backend = client
      const observer = observeAuth(client, (user) => {
        // Invocation is immediate, including fake adapters emitting in signIn.
        authTask = handleUser(user, client, epoch)
        void authTask.catch((error: unknown) => { if (backend === client) cloudError.value = message(error) })
      })
      stopAuth = observer.stop
      // Restoration can hang offline; never await it from local startup/signIn.
      void observer.restore().catch((error: unknown) => { if (backend === client) cloudError.value = message(error) })
      return client
    })()
    try { return await backendTask } finally { backendTask = null }
  }
  async function cloudAction(action: () => Promise<void>) {
    if (cloudBusy.value) return
    cloudBusy.value = true
    cloudError.value = null
    try { await action() } catch (error) { cloudError.value = message(error) }
    finally { cloudBusy.value = false }
  }
  async function signIn(provider: SignInProvider) {
    await cloudAction(async () => {
      if (!backendConfig) return
      await persistContext({
        ...context.value, consentBackend: backendConfig.id, signedOut: false, suspended: false,
      })
      const client = await ensureBackend()
      if (client) { await signInWithProvider(client, provider); await authTask }
    })
  }
  async function signOut() {
    const client = backend
    stopCloud()
    generation++
    // Hide immediately even when the server is offline or local persistence fails.
    apply(emptyHistory())
    family.value = null
    currentNamespace.value = GUEST_NAMESPACE
    try {
      await persistContext({ ...context.value, signedOut: true, consentBackend: null })
      await loadCurrent()
    } catch (error) {
      context.value.signedOut = true
      loadError.value = message(error)
      cloudError.value = message(error)
    }
    // Remote sign-out must not block local sign-out.
    if (client) void Promise.resolve().then(() => client.auth.signOut())
      .catch((error: unknown) => { cloudError.value = message(error) })
  }
  function requireCloud() {
    if (!backend || !cloudUser.value) throw new Error('Sign in to continue')
    return { client: backend, user: cloudUser.value, epoch: authGeneration }
  }
  async function createFamily() {
    await cloudAction(async () => {
      const { client, user, epoch } = requireCloud()
      if (family.value || context.value.suspended) {
        throw new Error('Resume sharing before starting another family')
      }
      if (context.value.selected?.revoked) {
        if (!(await beginExclusive())) throw new Error('Save local changes before starting another family')
        try { await retainFamilyOnDevice() } finally { endExclusive() }
      }
      if (context.value.selected) throw new Error('The active family changed')
      const created = await client.family.create()
      if (backend === client && epoch === authGeneration && cloudUser.value?.id === user.id) await selectFamily(created, user, client)
    })
  }
  async function acceptInvitation() {
    await cloudAction(async () => {
      const { client, user, epoch } = requireCloud()
      if (!pendingToken) throw new Error('No pending invitation')
      const joined = await client.family.join(pendingToken)
      if (backend !== client || epoch !== authGeneration || cloudUser.value?.id !== user.id) return
      await selectFamily(joined, user, client)
      forgetInvitation()
      pendingToken = null
      pendingInvitation.value = false
    })
  }
  const createInvitation = () => cloudAction(async () => {
    const { client, user } = requireCloud()
    const selected = family.value
    if (!selected || selected.ownerId !== user.id) throw new Error('Only the family creator can invite')
    const identity = captureIdentity()
    const created = await client.family.invite(selected.id)
    if (identity.isCurrent() && backend === client) {
      invitation.value = created
      scheduleSync(2_000)
    }
  })
  const revokeInvitation = () => cloudAction(async () => {
    const { client } = requireCloud()
    if (!family.value) return
    const identity = captureIdentity()
    await client.family.revokeInvitation(family.value.id)
    if (identity.isCurrent()) invitation.value = null
  })
  const leaveFamily = () => cloudAction(async () => {
    const { client, user } = requireCloud()
    if (!family.value || family.value.ownerId === user.id) throw new Error('The creator cannot leave their family')
    if (!(await flush())) throw new Error('Save local changes before leaving')
    const identity = captureIdentity()
    cancelSync()
    await client.family.leave(family.value.id)
    if (identity.isCurrent()) await retainFamilyOnDevice()
  })
  const removePartner = () => cloudAction(async () => {
    const { client, user } = requireCloud()
    const selected = family.value
    if (!selected || selected.ownerId !== user.id) throw new Error('Only the family creator can remove a parent')
    const partner = selected.members.find((item) => item.userId !== user.id)
    if (!partner) return
    const identity = captureIdentity()
    await client.family.removeMember(selected.id, partner.userId)
    if (identity.isCurrent()) await selectFamily({
      ...selected, members: selected.members.filter((item) => item.userId !== partner.userId),
    }, user, client)
  })
  const deleteFamily = () => cloudAction(async () => {
    const { client, user } = requireCloud()
    if (!family.value || family.value.ownerId !== user.id) throw new Error('Only the family creator can delete')
    const identity = captureIdentity()
    const familyId = family.value.id
    if (!(await beginExclusive())) throw new Error('Save local changes before deleting')
    const leaseId = `delete-${crypto.randomUUID()}`
    try {
      // Other tabs may still write recoverable local records, but must not
      // synchronize this namespace while cloud deletion is outstanding.
      await updateHistory(identity.namespace, (state) => {
        state.syncLease = { id: leaseId, until: Date.now() + 30_000 }
      }, identity.isCurrent)
      await cloudRequest(() => client.family.delete(familyId))
      if (!identity.isCurrent()) return
      await retainFamilyOnDevice()
    } finally {
      try {
        await updateHistory(identity.namespace, (state) => {
          if (state.syncLease?.id === leaseId) delete state.syncLease
        })
      } finally { endExclusive() }
    }
  })
  const resumeSharing = () => cloudAction(async () => {
    if (!backendConfig) return
    const selected = context.value.selected
    if (selected?.backendId && selected.backendId !== backendConfig.id) {
      throw new Error('This history belongs to a different backend. Export it and explicitly import into the new destination.')
    }
    await persistContext({ ...context.value, suspended: false, signedOut: false, consentBackend: backendConfig.id })
    const client = await ensureBackend()
    if (client) { await authTask; void triggerSync() }
  })
  async function resolveConflict(id: string, choice: 'local' | 'remote') {
    if (!(await beginExclusive())) return
    const identity = captureIdentity()
    try {
      const state = await resolveStoredConflict(identity.namespace, id, choice,
        Boolean(!context.value.signedOut && context.value.selected?.namespace === identity.namespace &&
          context.value.selected.backendId), identity.isCurrent)
      if (identity.isCurrent()) { apply(state); notify(identity.namespace) }
    } catch (error) { if (identity.isCurrent()) saveError.value = message(error) }
    finally { endExclusive(); scheduleSync() }
  }
  async function exportBackup(): Promise<unknown> {
    if (!(await beginExclusive())) throw new Error('Save local changes before exporting')
    const identity = captureIdentity()
    try {
      const state = await loadHistory(identity.namespace)
      if (!identity.isCurrent()) throw new Error('The active history changed')
      return createBackup(state, {
        backendId: context.value.selected?.namespace === identity.namespace ? context.value.selected.backendId : null,
        namespace: identity.namespace,
      })
    } finally { endExclusive() }
  }
  async function clearPendingImport(namespace: Namespace) {
    if (context.value.pendingImportNamespace === namespace) {
      await persistContext({ ...context.value, pendingImportNamespace: null, pendingImportUserId: null })
    }
  }
  async function importBackup(value: unknown): Promise<boolean> {
    let imported: HistoryState
    try { imported = parseBackup(value) } catch (error) { saveError.value = message(error); return false }
    if (!(await beginExclusive())) return false
    const identity = captureIdentity()
    try {
      const existing = await loadHistory(identity.namespace)
      if (!identity.isCurrent()) return false
      const restored = cloneHistory(existing)
      restored.data = mergeAppData(existing.data, imported.data)
      for (const kind of ['feed', 'weight'] as const) {
        const old = kind === 'feed' ? existing.data.feeds : existing.data.weights
        const incoming = kind === 'feed' ? imported.data.feeds : imported.data.weights
        for (const row of incoming) {
          const prior = old.find((item) => item.id === row.id)
          if (prior && !sameRecord(prior, row)) {
            restored.conflicts.push({
              id: `${recordKey(kind, row.id)}:restore:${crypto.randomUUID()}`, kind, local: row, source: 'restore',
              remote: { kind, record: prior, version: '' } as SyncConflict['remote'], base: null,
            })
            // Never silently resurrect a saved tombstone during import.
            if (prior.deletedAt) putRecord(restored, kind, prior)
          }
        }
      }
      const ids = new Set(restored.conflicts.map((item) => item.id))
      for (const conflict of imported.conflicts) {
        restored.conflicts.push({ ...conflict, id: ids.has(conflict.id) ? `${conflict.id}:restore:${crypto.randomUUID()}` : conflict.id })
      }
      for (const mutation of imported.pending) {
        const duplicate = restored.pending.find((item) => item.mutationId === mutation.mutationId)
        if (duplicate && sameRecord(duplicate, mutation)) continue
        const restoredId = duplicate ? crypto.randomUUID() : mutation.mutationId
        restored.pending.push({ ...mutation, mutationId: restoredId })
        restored.bases[restoredId] = imported.bases[mutation.mutationId] ?? null
      }
      restored.cursor = null // A backup never grants a trusted server checkpoint.
      // Opaque provenance is recoverable, but this isolated namespace cannot
      // synchronize. A later family selection uses its own fresh checkpoint.
      restored.versions = { ...imported.versions, ...restored.versions }
      const namespace: Namespace = `recovery-${crypto.randomUUID()}`
      await updateHistory(namespace, (state) => Object.assign(state, restored), identity.isCurrent)
      if (!identity.isCurrent()) return false
      // Imported records stay in an isolated, suspended recovery history so
      // they cannot be uploaded automatically. Preserve the authenticated
      // identity though: importing local data must not look like a sign-out.
      stopCloud({ preserveUser: true })
      const selection: LocalSelection = { namespace, backendId: null, user: null, family: null, revoked: false }
      await persistContext({
        ...context.value, selected: selection, consentBackend: null, suspended: true, signedOut: false,
        pendingImportNamespace: namespace, pendingImportUserId: cloudUser.value?.id ?? null,
        histories: [...context.value.histories, selection],
      })
      await loadCurrent()
      return true
    } catch (error) {
      if (identity.isCurrent()) saveError.value = message(error)
      return false
    } finally { endExclusive() }
  }
  async function refreshContext() {
    try {
      const saved = await readLocalContext<LocalContext>()
      if (!saved || saved.revision === context.value.revision) return
      stopCloud()
      context.value = saved
      await loadCurrent()
      if (!needsResume.value && !saved.signedOut) void ensureBackend().catch((error: unknown) => { cloudError.value = message(error) })
    } catch (error) { cloudError.value = message(error) }
  }
  const handleOnline = () => { void triggerSync() }
  const handleFocus = () => { void refreshContext(); void refreshFromStorage(); void triggerSync() }
  const handleVisibility = () => { subscribe(); if (document.visibilityState !== 'hidden') handleFocus() }
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!saving.value && !saveError.value && drafts.size === 0) return
    event.preventDefault()
    event.returnValue = ''
  }
  onMounted(async () => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('little-sips-data')
      channel.onmessage = (event: MessageEvent<{ namespace?: string; context?: boolean }>) => {
        if (event.data?.context) void refreshContext()
        else if (event.data?.namespace === currentNamespace.value) void refreshFromStorage()
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibility)
    pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') void triggerSync() }, 60_000)
    try {
      pendingToken = captureInvitation()
      pendingInvitation.value = Boolean(pendingToken)
    } catch (error) { cloudError.value = message(error) }
    try {
      context.value = await readLocalContext<LocalContext>() ?? emptyContext()
      if (!context.value.signedOut && (
        (!backendConfig && (context.value.consentBackend || context.value.selected?.backendId)) ||
        (context.value.selected?.backendId && context.value.selected.backendId !== backendConfig?.id)
      )) await persistContext({ ...context.value, suspended: true })
      if (disposed) return
      await loadCurrent()
      if (!disposed && !loadError.value && !needsResume.value) {
        void ensureBackend().catch((error: unknown) => { cloudError.value = message(error) })
      }
    } catch (error) { loadError.value = message(error); loading.value = false }
  })
  onUnmounted(() => {
    disposed = true
    generation++
    stopCloud()
    channel?.close()
    clearInterval(pollTimer)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('beforeunload', handleBeforeUnload)
    document.removeEventListener('visibilitychange', handleVisibility)
  })
  return {
    data: shallowReadonly(data), currentNamespace, loading, loadError, saveError, saving, exclusive,
    commit, retrySave, flush, triggerSync, cancelSync, beginExclusive, endExclusive, captureIdentity,
    reload: loadCurrent, backendAvailable, cloudUser, family, sharingEnabled, needsResume, cloudBusy,
    cloudError, invitation, pendingInvitation, pendingCount, conflicts, hasLocal, signIn, signOut, createFamily,
    acceptInvitation, createInvitation, revokeInvitation, leaveFamily, removePartner, deleteFamily,
    resumeSharing, resolveConflict, exportBackup, importBackup, pendingImportNamespace, clearPendingImport,
  }
}
