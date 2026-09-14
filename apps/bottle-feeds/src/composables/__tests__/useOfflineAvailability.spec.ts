import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useOfflineAvailability } from '../useOfflineAvailability'

class Worker extends EventTarget {
  state: ServiceWorkerState = 'activated'
  complete = true
  postMessage = vi.fn(
    (message: { type: string }, ports?: Array<{ reply: (ready: boolean) => void }>) => {
      if (message.type === 'CHECK_OFFLINE_READY') ports?.[0]?.reply(this.complete)
    },
  )
  transition(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class Channel {
  port1 = {
    onmessage: null as ((event: { data: { ready: boolean } }) => void) | null,
    close: vi.fn(),
  }
  port2 = { reply: (ready: boolean) => this.port1.onmessage?.({ data: { ready } }) }
}

const active = new Worker()
const reload = vi.fn()
let waiting: Worker | null
let installing: Worker | null
const registration = Object.assign(new EventTarget(), {
  active,
  get waiting() {
    return waiting
  },
  get installing() {
    return installing
  },
  update: vi.fn().mockResolvedValue(undefined),
})
const serviceWorker = Object.assign(new EventTarget(), {
  register: vi.fn().mockResolvedValue(registration),
})
const wrappers: Array<{ unmount: () => void }> = []

function setup() {
  let state!: ReturnType<typeof useOfflineAvailability>
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          state = useOfflineAvailability()
          return () => null
        },
      }),
    ),
  )
  return state
}

beforeEach(() => {
  vi.stubEnv('PROD', true)
  vi.stubEnv('BASE_URL', '/new-parents-tool/')
  vi.stubGlobal('navigator', { serviceWorker })
  vi.stubGlobal('MessageChannel', Channel)
  vi.stubGlobal('location', { reload })
  active.state = 'activated'
  active.complete = true
  waiting = null
  installing = null
  // Object.assign evaluates accessors; restore them for mutable test lifecycle states.
  Object.defineProperties(registration, {
    waiting: { configurable: true, get: () => waiting },
    installing: { configurable: true, get: () => installing },
  })
  serviceWorker.register.mockResolvedValue(registration)
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('offline availability', () => {
  it('never registers a worker in development', async () => {
    vi.stubEnv('PROD', false)
    const state = setup()
    await flushPromises()
    expect(serviceWorker.register).not.toHaveBeenCalled()
    expect(state.ready.value).toBe(false)
  })

  it.each(['/', '/new-parents-tool/'])(
    'registers under %s and verifies every cached file',
    async (base) => {
      vi.stubEnv('BASE_URL', base)
      const state = setup()
      expect(state.ready.value).toBe(false)
      await flushPromises()
      expect(serviceWorker.register).toHaveBeenCalledWith(`${base}sw.js`, {
        scope: base,
        updateViaCache: 'none',
      })
      expect(active.postMessage).toHaveBeenCalledWith(
        { type: 'CHECK_OFFLINE_READY' },
        expect.any(Array),
      )
      expect(state.ready.value).toBe(true)
      expect(state.error.value).toBeNull()
    },
  )

  it('does not advertise incomplete or evicted caches as ready', async () => {
    active.complete = false
    const state = setup()
    await flushPromises()
    expect(state.ready.value).toBe(false)
    expect(state.error.value).toContain('incomplete')
  })

  it('reports unsupported browsers and registration failures', async () => {
    vi.stubGlobal('navigator', {})
    const unsupported = setup()
    await flushPromises()
    expect(unsupported.error.value).toContain('cannot prepare')
    vi.stubGlobal('navigator', { serviceWorker })
    serviceWorker.register.mockRejectedValueOnce(new Error('Storage denied'))
    const failed = setup()
    await flushPromises()
    expect(failed.ready.value).toBe(false)
    expect(failed.error.value).toContain('failed')
  })

  it('waits for activation rather than equating registration with readiness', async () => {
    active.state = 'activating'
    const state = setup()
    await flushPromises()
    expect(state.ready.value).toBe(false)
    active.transition('activated')
    await flushPromises()
    expect(state.ready.value).toBe(true)
  })

  it('reports an asset installation failure', async () => {
    installing = new Worker()
    installing.state = 'installing'
    const state = setup()
    await flushPromises()
    installing.transition('redundant')
    expect(state.error.value).toContain('failed')
  })

  it('reports a worker that never confirms complete offline files', async () => {
    vi.useFakeTimers()
    active.postMessage.mockImplementationOnce(() => {})
    const state = setup()
    await vi.advanceTimersByTimeAsync(15_001)
    expect(state.ready.value).toBe(false)
    expect(state.error.value).toContain('did not respond')
  })

  it('never reloads after an update activation failure', async () => {
    waiting = new Worker()
    waiting.state = 'installed'
    const state = setup()
    await flushPromises()
    const applied = state.applyUpdate()
    queueMicrotask(() => waiting?.transition('redundant'))
    await expect(applied).rejects.toThrow('failed to activate')
    expect(reload).not.toHaveBeenCalled()
    expect(state.error.value).toContain('failed to activate')
  })

  it('keeps an update waiting and reloads only after explicit successful activation', async () => {
    waiting = new Worker()
    waiting.state = 'installed'
    const state = setup()
    await flushPromises()
    expect(state.updateAvailable.value).toBe(true)
    expect(waiting.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    const applied = state.applyUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    waiting.transition('activated')
    await applied
    expect(state.updateAvailable.value).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })
})
