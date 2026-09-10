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

export type AuthStep = 'idle' | 'sending' | 'check-email' | 'signed-in' | 'error'

export const authStep = ref<AuthStep>('idle')
export const authError = ref<string | null>(null)
let initialization: Promise<Session | null> | null = null

/**
 * Initialise auth: restore any persisted session and register the
 * auth state change listener.  Should be called once at app startup.
 */
export async function initAuth(): Promise<Session | null> {
  if (!isSupabaseConfigured || !supabase) return null
  if (initialization) return initialization
  const client = supabase
  initialization = (async () => {
    let receivedAuthEvent = false
    const { data: listener } = client.auth.onAuthStateChange((_event, newSession) => {
      receivedAuthEvent = true
      session.value = newSession
      authStep.value = newSession ? 'signed-in' : 'idle'
    })
    try {
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      if (!receivedAuthEvent) session.value = data.session
      return session.value
    } catch (error) {
      listener.subscription.unsubscribe()
      initialization = null
      throw error
    }
  })()
  return initialization
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
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  session.value = null
  authStep.value = 'idle'
  authError.value = null
}
