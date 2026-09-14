import type { CloudUser, Family } from '../backends/contracts'
import type { Namespace } from '../storage'

export interface LocalSelection {
  namespace: Namespace
  backendId: string | null
  user: CloudUser | null
  family: Family | null
  revoked: boolean
}

export interface LocalContext {
  selected: LocalSelection | null
  histories: LocalSelection[]
  signedOut: boolean
  consentBackend: string | null
  suspended: boolean
  revision: string
}

export const emptyContext = (): LocalContext => ({
  selected: null, histories: [], signedOut: false,
  consentBackend: null, suspended: false, revision: '',
})

export function familyNamespace(backendId: string, userId: string, familyId: string): Namespace {
  return `shared-${encodeURIComponent(backendId)}~${encodeURIComponent(userId)}~${encodeURIComponent(familyId)}`
}

const INVITATION_KEY = 'little-sips:pending-invitation'
export function captureInvitation(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('invite')
  if (token) {
    // Persist before scrubbing the address so an OAuth redirect cannot lose it.
    sessionStorage.setItem(INVITATION_KEY, token)
    params.delete('invite')
    const hash = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`)
  }
  return sessionStorage.getItem(INVITATION_KEY)
}

export function forgetInvitation() { sessionStorage.removeItem(INVITATION_KEY) }
