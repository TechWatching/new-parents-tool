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
      const user = await backend.auth.restore()
      if (active && !receivedEvent) changed(user)
    },
    stop: () => { active = false; stop() },
  }
}
