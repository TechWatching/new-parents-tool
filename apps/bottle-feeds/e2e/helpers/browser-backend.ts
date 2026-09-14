import {
  BackendError,
  type CloudBackend,
  type CloudUser,
} from '../../src/backends/contracts'

// Vite serves this only when Playwright replaces the backend composition module.
// This is a contract fake, not Supabase OAuth or SQL/RLS coverage.
export const backendConfig = { id: 'test:family-backend' }
const sessionKey = 'sharing-test:session'

export async function createBackend(): Promise<CloudBackend> {
  const listeners = new Set<(user: CloudUser | null) => void>()
  let user: CloudUser | null = JSON.parse(localStorage.getItem(sessionKey) ?? 'null')
  function change(next: CloudUser | null) {
    user = next
    if (next) localStorage.setItem(sessionKey, JSON.stringify(next))
    else localStorage.removeItem(sessionKey)
    for (const listener of listeners) listener(next)
  }
  async function request<T>(operation: string, body: object = {}, signal?: AbortSignal): Promise<T> {
    if (!navigator.onLine) throw new BackendError('transient', 'Device is offline')
    const response = await fetch(`/__sharing-test__/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, actor: user?.id ?? null }),
      // Exercise the core generation guard even with adapters whose in-flight
      // transport cannot be cancelled on an identity change.
      signal: localStorage.getItem('sharing-test:ignore-abort') === 'true' ? undefined : signal,
    })
    const result = await response.json()
    if (!response.ok) throw new BackendError(result.code, result.message)
    return result as T
  }
  return {
    id: backendConfig.id,
    auth: {
      restore: async () => user,
      signIn: async () => {
        const id = localStorage.getItem('sharing-test:account') ?? 'mother'
        change({ id, email: `${id}@example.test` })
      },
      signOut: async () => change(null),
      onChange: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    family: {
      current: () => request('family/current'),
      create: () => request('family/create'),
      invite: (familyId) => request('family/invite', { familyId }),
      revokeInvitation: (familyId) => request('family/revoke', { familyId }),
      join: (token) => request('family/join', { token }),
      leave: (familyId) => request('family/leave', { familyId }),
      removeMember: (familyId, userId) => request('family/remove', { familyId, userId }),
      delete: (familyId) => request('family/delete', { familyId }),
    },
    sync: {
      pull: (familyId, cursor, page, signal) => request('sync/pull', { familyId, cursor, page }, signal),
      push: (familyId, mutations, signal) => request('sync/push', { familyId, mutations }, signal),
    },
    dispose: () => listeners.clear(),
  }
}
