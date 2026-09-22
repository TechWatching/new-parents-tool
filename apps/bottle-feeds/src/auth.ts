import type { CloudBackend, CloudUser, SignInProvider } from './backends/contracts'

export function redirectUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
}

export async function signInWithProvider(backend: CloudBackend, provider: SignInProvider) {
  await backend.auth.signIn(provider, redirectUrl())
}

/** Listen before restore: an immediate OAuth event must beat a stale restore. */
export function observeAuth(
  backend: CloudBackend,
  changed: (user: CloudUser | null) => void,
) {
  let active = true
  let receivedEvent = false
  const stop = backend.auth.onChange((user) => {
    receivedEvent = true
    if (active) changed(user)
  })
  return {
    restore: async () => {
      try {
        const user = await backend.auth.restore()
        if (active && !receivedEvent) changed(user)
      } catch (error) {
        // The SDK can emit INITIAL_SESSION while restore is still resolving.
        // The event is authoritative, so do not surface its stale restore as
        // an authentication failure to the user.
        if (active && receivedEvent && (error as { code?: unknown }).code === 'auth') return
        throw error
      }
    },
    stop: () => { active = false; stop() },
  }
}
