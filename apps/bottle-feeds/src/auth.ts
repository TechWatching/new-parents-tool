import { computed, ref } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import { GUEST_NAMESPACE, type Namespace } from './storage'

export const session = ref<Session | null>(null)
export const authUser = computed<User | null>(() => session.value?.user ?? null)
export const isAuthenticated = computed(() => Boolean(authUser.value))

/** Storage namespace for the currently active identity. */
export const activeNamespace = computed<Namespace>(() => {
  const uid = authUser.value?.id
  return uid ? (`user-${uid}` as Namespace) : GUEST_NAMESPACE
})

export type AuthStep =
  | 'idle'
  | 'sending'
  | 'check-email'
  | 'signed-in'
  | 'error'

export const authStep = ref<AuthStep>('idle')
export const authError = ref<string | null>(null)

/**
 * Initialise auth: restore any persisted session and register the
 * auth state change listener.  Should be called once at app startup.
 */
export async function initAuth(): Promise<Session | null> {
  if (!isSupabaseConfigured || !supabase) return null

  const { data } = await supabase.auth.getSession()
  session.value = data.session

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session.value = newSession
    if (newSession) authStep.value = 'signed-in'
  })

  return session.value
}

/**
 * Request a magic-link / OTP email.
 * The link redirects back to the current page which Supabase will detect
 * via the URL hash.
 */
export async function signInWithEmail(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  authStep.value = 'sending'
  authError.value = null
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  })
  if (error) {
    authStep.value = 'error'
    authError.value = error.message
    throw error
  }
  authStep.value = 'check-email'
}

/** Sign out and clear the local session. */
export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
  session.value = null
  authStep.value = 'idle'
  authError.value = null
}
