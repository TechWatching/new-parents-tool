import { describe, expect, it, vi } from 'vite-plus/test'
import { observeAuth } from '../auth'
import { BackendError, type CloudBackend, type CloudUser } from '../backends/contracts'

describe('observeAuth', () => {
  it('does not expose a stale restore error after an auth event has won the race', async () => {
    let listener: (user: CloudUser | null) => void = () => {}
    const backend = {
      auth: {
        onChange: vi.fn((next: (user: CloudUser | null) => void) => {
          listener = next
          return () => {}
        }),
        restore: vi.fn(async () => {
          throw new BackendError('auth', 'Authentication changed')
        }),
      },
    } as unknown as CloudBackend
    const changed = vi.fn()
    const observer = observeAuth(backend, changed)

    listener({ id: 'parent' })

    await expect(observer.restore()).resolves.toBeUndefined()
    expect(changed).toHaveBeenCalledExactlyOnceWith({ id: 'parent' })
  })
})
