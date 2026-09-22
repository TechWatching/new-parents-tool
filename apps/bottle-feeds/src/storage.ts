import { createStore, get, promisifyRequest } from 'idb-keyval'
import { createStorage, prefixStorage, type Driver } from 'unstorage'
import { mergeAppData } from './merge'
import { parseAppData } from './validation'
import type { AppData } from './types'
import { applyLocalEdit, cloneHistory, emptyHistory, type HistoryState } from './sharing/state'
import { parseBackup } from './backup'

export { parseAppData, isValidAppData, addMissingMetadata } from './validation'

export const GUEST_NAMESPACE = 'guest'
export const DATA_KEY = 'data'
export const SYNC_DIRTY_KEY = 'sync-dirty'
export type Namespace = typeof GUEST_NAMESPACE | `user-${string}` | `shared-${string}` | `recovery-${string}`

const useStore = createStore('new-parents-tool', 'bottle-feeds')
let testDriver: Driver | null = null
const queues = new Map<Namespace, Promise<unknown>>()

/** Test-only driver injection; production never falls back to volatile memory. */
export function _setTestDriver(driver: Driver | null): void {
  testDriver = driver
  queues.clear()
}

function serialized<T>(
  namespace: Namespace | readonly Namespace[],
  action: () => Promise<T>,
): Promise<T> {
  const namespaces = typeof namespace === 'string' ? [namespace] : [...new Set(namespace)].sort()
  // Reserve every queue synchronously, so a multi-namespace move cannot deadlock
  // or be overtaken by a single-namespace edit while it waits for another queue.
  const result = Promise.all(
    namespaces.map((key) => queues.get(key) ?? Promise.resolve()),
  ).then(action)
  const tail = result.catch(() => {})
  for (const key of namespaces) queues.set(key, tail)
  void tail.then(() => {
    for (const key of namespaces) {
      if (queues.get(key) === tail) queues.delete(key)
    }
  })
  return result
}

function storedData(value: unknown): AppData {
  if (value === undefined) return { feeds: [], weights: [] }
  return parseAppData(typeof value === 'string' ? JSON.parse(value) : value)
}

interface Change<T> {
  result: T
  data?: AppData
  dirty?: boolean
  clear?: boolean
  history?: HistoryState
}

function decodeHistory(value: unknown): HistoryState {
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  const data = storedData(raw)
  if (!raw || typeof raw !== 'object' || !('recovery' in raw)) return { ...emptyHistory(), data }
  const recovery = (raw as { recovery: Omit<HistoryState, 'data'> }).recovery
  const state = parseBackup({ format: 'little-sips-backup', version: 1, records: data, recovery })
  if (recovery.syncLease !== undefined) {
    const lease = recovery.syncLease
    if (!lease || typeof lease.id !== 'string' || typeof lease.until !== 'number' || !Number.isFinite(lease.until)) {
      throw new Error('Invalid persisted synchronization lease')
    }
    state.syncLease = { id: lease.id, until: lease.until }
  }
  return state
}

function encodeHistory(history: HistoryState) {
  const { data, ...recovery } = history
  return { ...parseAppData(data), recovery: cloneHistory(recovery) }
}

/** The synchronous transform keeps the read and both writes in one IDB transaction. */
function transaction<T>(
  namespace: Namespace,
  transform: (stored: unknown, context?: unknown) => Change<T>,
): Promise<T> {
  if (testDriver) {
    const storage = prefixStorage(createStorage({ driver: testDriver }), namespace)
    return serialized(namespace, async () => {
      const stored = await storage.hasItem(DATA_KEY) ? await storage.getItem(DATA_KEY) : undefined
      const context = await createStorage({ driver: testDriver! }).getItem(CONTEXT_KEY)
      const change = transform(stored, context)
      if (change.clear) {
        await storage.removeItem(DATA_KEY)
        await storage.removeItem(SYNC_DIRTY_KEY)
      } else {
        if (change.history) await storage.setItem(DATA_KEY, encodeHistory(change.history))
        else if (change.data !== undefined) await storage.setItem(DATA_KEY, change.data)
        if (change.dirty === true) await storage.setItem(SYNC_DIRTY_KEY, true)
        if (change.dirty === false) await storage.removeItem(SYNC_DIRTY_KEY)
      }
      return change.result
    })
  }

  return useStore('readwrite', (store) => new Promise<T>((resolve, reject) => {
    let result: T
    let transformFailed = false
    const completion = promisifyRequest(store.transaction)
    void completion.then(() => resolve(result), (error: unknown) => {
      if (!transformFailed) reject(error)
    })
    const request = store.get(`${namespace}:${DATA_KEY}`)
    const contextRequest = store.get(CONTEXT_KEY)
    contextRequest.onsuccess = () => {
      try {
        const change = transform(request.result, contextRequest.result)
        result = change.result
        if (change.clear) {
          store.delete(`${namespace}:${DATA_KEY}`)
          store.delete(`${namespace}:${SYNC_DIRTY_KEY}`)
        } else {
          if (change.history) store.put(encodeHistory(change.history), `${namespace}:${DATA_KEY}`)
          else if (change.data !== undefined) store.put(change.data, `${namespace}:${DATA_KEY}`)
          if (change.dirty === true) store.put(true, `${namespace}:${SYNC_DIRTY_KEY}`)
          if (change.dirty === false) store.delete(`${namespace}:${SYNC_DIRTY_KEY}`)
        }

      } catch (error) {
        transformFailed = true
        // Reject the original validation/write error, not the resulting AbortError.
        reject(error)
        try {
          store.transaction.abort()
        } catch {
          // An already-aborted transaction still reports the original error.
        }
      }
    }
  }))
}

/** Records, immutable requests, alternatives and cursor share one atomic value. */
export async function updateHistory(
  namespace: Namespace,
  update: (state: HistoryState) => void,
  isCurrent: () => boolean = () => true,
  contextRevision?: string,
): Promise<HistoryState> {
  return transaction(namespace, (stored, context) => {
    if (!isCurrent()) throw new DOMException('The active history changed', 'AbortError')
    if (contextRevision !== undefined) {
      const saved = typeof context === 'string' ? JSON.parse(context) : context
      if (!saved || saved.revision !== contextRevision) {
        throw new DOMException('The active history changed in another tab', 'AbortError')
      }
    }
    const state = decodeHistory(stored)
    update(state)
    state.data = parseAppData(state.data)
    return { result: cloneHistory(state), history: state }
  })
}

export async function loadHistory(namespace: Namespace = GUEST_NAMESPACE): Promise<HistoryState> {
  if (testDriver) {
    const storage = prefixStorage(createStorage({ driver: testDriver }), namespace)
    return serialized(namespace, async () => decodeHistory(
      await storage.hasItem(DATA_KEY) ? await storage.getItem(DATA_KEY) : undefined,
    ))
  }
  return decodeHistory(await get(`${namespace}:${DATA_KEY}`, useStore))
}

export const CONTEXT_KEY = 'local-context'
export async function readLocalContext<T>(): Promise<T | null> {
  const value = testDriver
    ? await createStorage({ driver: testDriver }).getItem(CONTEXT_KEY)
    : await get(CONTEXT_KEY, useStore)
  return value == null ? null : cloneHistory(typeof value === 'string' ? JSON.parse(value) : value) as T
}

export async function writeLocalContext<T>(context: T, isCurrent: () => boolean = () => true): Promise<void> {
  if (testDriver) {
    if (!isCurrent()) throw new DOMException('The active identity changed', 'AbortError')
    await createStorage({ driver: testDriver }).setItem(CONTEXT_KEY, JSON.stringify(context))
    return
  }
  await useStore('readwrite', (store) => {
    if (!isCurrent()) throw new DOMException('The active identity changed', 'AbortError')
    store.put(cloneHistory(context), CONTEXT_KEY)
    return promisifyRequest(store.transaction)
  })
}

export async function loadData(namespace: Namespace = GUEST_NAMESPACE): Promise<AppData> {
  if (testDriver) {
    const storage = prefixStorage(createStorage({ driver: testDriver }), namespace)
    return serialized(namespace, async () => storedData(
      await storage.hasItem(DATA_KEY) ? await storage.getItem(DATA_KEY) : undefined,
    ))
  }
  return storedData(await get(`${namespace}:${DATA_KEY}`, useStore))
}

/** Exact replacement, intended for fixtures and explicit replacement workflows. */
export async function saveData(
  data: AppData,
  namespace: Namespace = GUEST_NAMESPACE,
): Promise<void> {
  const parsed = parseAppData(data)
  await transaction(namespace, () => ({ result: undefined, data: parsed }))
}

export const saveDataStrict = saveData

/** Merge with the latest persisted snapshot, including edits from other tabs. */
export async function mergeDataStrict(
  incoming: AppData,
  namespace: Namespace,
  dirty = false,
): Promise<AppData> {
  const parsed = parseAppData(incoming)
  return transaction(namespace, (stored) => {
    const data = mergeAppData(storedData(stored), parsed)
    const raw = typeof stored === 'string' ? JSON.parse(stored) : stored
    if (namespace.startsWith('shared-') || (raw && typeof raw === 'object' && 'recovery' in raw)) {
      const state = decodeHistory(stored)
      applyLocalEdit(state, state.data, data, dirty && namespace.startsWith('shared-'))
      return { result: state.data, history: state }
    }
    return { result: data, data, ...(dirty ? { dirty: true } : {}) }
  })
}

function sameRecords<T extends { id: string }>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false
  const records = new Map(right.map((row) => [row.id, JSON.stringify(row)]))
  return left.every((row) => records.get(row.id) === JSON.stringify(row))
}

/** A completed network request only acknowledges the exact snapshot it sent. */
export async function finishSync(
  synced: AppData,
  namespace: Namespace,
): Promise<{ data: AppData; pending: boolean }> {
  const parsed = parseAppData(synced)
  return transaction(namespace, (stored) => {
    const data = storedData(stored)
    const pending = !sameRecords(data.feeds, parsed.feeds) ||
      !sameRecords(data.weights, parsed.weights)
    return { result: { data, pending }, dirty: pending }
  })
}

export async function clearData(namespace: Namespace): Promise<void> {
  await transaction(namespace, () => ({ result: undefined, clear: true }))
}

/** Move the latest active account records to guest without a copy/delete race. */
export async function moveDataToGuest(namespace: Namespace): Promise<AppData> {
  if (namespace === GUEST_NAMESPACE) {
    throw new Error('Cannot move guest data to itself')
  }

  const mergeActive = (sourceValue: unknown, guestValue: unknown): AppData => {
    const source = storedData(sourceValue)
    return mergeAppData(storedData(guestValue), {
      feeds: source.feeds.filter((row) => !row.deletedAt),
      weights: source.weights.filter((row) => !row.deletedAt),
    })
  }

  if (testDriver) {
    const base = createStorage({ driver: testDriver })
    const source = prefixStorage(base, namespace)
    const guest = prefixStorage(base, GUEST_NAMESPACE)
    return serialized([namespace, GUEST_NAMESPACE], async () => {
      const sourceValue = await source.hasItem(DATA_KEY) ? await source.getItem(DATA_KEY) : undefined
      const guestValue = await guest.hasItem(DATA_KEY) ? await guest.getItem(DATA_KEY) : undefined
      const data = mergeActive(sourceValue, guestValue)
      // Never remove the source unless the guest copy has been persisted.
      await guest.setItem(DATA_KEY, data)
      await source.removeItem(SYNC_DIRTY_KEY)
      await source.removeItem(DATA_KEY)
      return data
    })
  }

  return useStore('readwrite', (store) => new Promise<AppData>((resolve, reject) => {
    let data: AppData
    let transformFailed = false
    void promisifyRequest(store.transaction).then(() => resolve(data), (error: unknown) => {
      if (!transformFailed) reject(error)
    })
    const source = store.get(`${namespace}:${DATA_KEY}`)
    const guest = store.get(`${GUEST_NAMESPACE}:${DATA_KEY}`)
    // IDB requests run in order; both results are available in this callback.
    guest.onsuccess = () => {
      try {
        data = mergeActive(source.result, guest.result)
        store.put(data, `${GUEST_NAMESPACE}:${DATA_KEY}`)
        store.delete(`${namespace}:${DATA_KEY}`)
        store.delete(`${namespace}:${SYNC_DIRTY_KEY}`)
      } catch (error) {
        transformFailed = true
        reject(error)
        try {
          store.transaction.abort()
        } catch {
          // Preserve the original error if the transaction already aborted.
        }
      }
    }
  }))
}

export async function markDirty(namespace: Namespace): Promise<void> {
  await transaction(namespace, () => ({ result: undefined, dirty: true }))
}

export async function clearDirty(namespace: Namespace): Promise<void> {
  await transaction(namespace, () => ({ result: undefined, dirty: false }))
}

export async function isDirty(namespace: Namespace): Promise<boolean> {
  if (testDriver) {
    const storage = prefixStorage(createStorage({ driver: testDriver }), namespace)
    return serialized(namespace, async () => Boolean(await storage.getItem(SYNC_DIRTY_KEY)))
  }
  const value = await get(`${namespace}:${SYNC_DIRTY_KEY}`, useStore)
  return value !== undefined && Boolean(typeof value === 'string' ? JSON.parse(value) : value)
}
