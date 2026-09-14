import { onMounted, onUnmounted, ref } from 'vue'

export function useOfflineAvailability() {
  const ready = ref(false)
  const updateAvailable = ref(false)
  const error = ref<string | null>(null)
  let registration: ServiceWorkerRegistration | undefined
  let disposed = false
  let checking = false
  const cleanups: Array<() => void> = []

  function listen(target: EventTarget, type: string, callback: () => void) {
    target.addEventListener(type, callback)
    cleanups.push(() => target.removeEventListener(type, callback))
  }

  async function verifyCache() {
    const worker = registration?.active
    if (!worker || worker.state !== 'activated' || checking || disposed) return
    checking = true
    try {
      const complete = await new Promise<boolean>((resolve, reject) => {
        const channel = new MessageChannel()
        const timeout = window.setTimeout(() => {
          channel.port1.close()
          reject(new Error('Offline preparation did not respond. Reload online to try again.'))
        }, 15_000)
        channel.port1.onmessage = (event: MessageEvent<{ ready: boolean }>) => {
          window.clearTimeout(timeout)
          channel.port1.close()
          resolve(event.data.ready === true)
        }
        worker.postMessage({ type: 'CHECK_OFFLINE_READY' }, [channel.port2])
      })
      if (disposed) return
      ready.value = complete
      error.value = complete
        ? null
        : 'Offline files are incomplete. Reconnect and reload to prepare this device again.'
    } catch (cause) {
      if (!disposed) {
        ready.value = false
        error.value = cause instanceof Error ? cause.message : 'Offline preparation failed.'
      }
    } finally {
      checking = false
    }
  }

  function observeWorker(worker: ServiceWorker | null) {
    if (!worker) return
    const changed = () => {
      if (disposed) return
      if (worker.state === 'installed') {
        updateAvailable.value = !!registration?.waiting && !!registration.active
      } else if (worker.state === 'activated') {
        updateAvailable.value = !!registration?.waiting
        void verifyCache()
      } else if (worker.state === 'redundant') {
        error.value = 'Offline preparation failed. Reconnect and reload to try again.'
      }
    }
    listen(worker, 'statechange', changed)
    changed()
  }

  async function start() {
    if (!import.meta.env.PROD) return
    if (!('serviceWorker' in navigator)) {
      error.value = 'This browser cannot prepare the app for offline reopening.'
      return
    }
    try {
      registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      if (disposed) return
      updateAvailable.value = !!registration.waiting
      listen(registration, 'updatefound', () => observeWorker(registration?.installing ?? null))
      listen(navigator.serviceWorker, 'controllerchange', () => void verifyCache())
      listen(window, 'online', () => {
        void verifyCache()
        void registration?.update().catch(() => {
          error.value =
            'The app update could not be checked. Your current offline files are retained.'
        })
      })
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') void verifyCache()
      })
      observeWorker(registration.installing)
      observeWorker(registration.active)
      await verifyCache()
    } catch {
      if (!disposed) error.value = 'Offline preparation failed. Reconnect and reload to try again.'
    }
  }

  async function applyUpdate(): Promise<void> {
    const waiting = registration?.waiting
    if (!waiting) return
    // The caller must guard forms and flush local persistence before this call.
    // This explicit action is the only place allowed to reload the UI.
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        waiting.removeEventListener('statechange', changed)
        error.value = 'The update could not be activated. Your current app remains available.'
        reject(new Error(error.value))
      }, 15_000)
      const changed = () => {
        if (waiting.state !== 'activated' && waiting.state !== 'redundant') return
        window.clearTimeout(timeout)
        waiting.removeEventListener('statechange', changed)
        if (waiting.state === 'redundant') {
          error.value = 'The update failed to activate.'
          reject(new Error(error.value))
        } else {
          updateAvailable.value = false
          resolve()
        }
      }
      waiting.addEventListener('statechange', changed)
      waiting.postMessage({ type: 'SKIP_WAITING' })
    })
    await verifyCache()
    if (ready.value) globalThis.location.reload()
  }

  onMounted(() => void start())
  onUnmounted(() => {
    disposed = true
    cleanups.forEach((cleanup) => cleanup())
  })
  return { ready, updateAvailable, error, applyUpdate }
}
