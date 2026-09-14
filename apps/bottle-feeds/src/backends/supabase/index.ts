import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseAppData } from '../../validation'
import {
  BackendError,
  type CloudBackend,
  type CloudRecord,
  type CloudUser,
  type DeltaPage,
  type Family,
  type Invitation,
  type Mutation,
  type MutationResult,
} from '../contracts'

export function normalizeError(error: unknown): BackendError {
  if (error instanceof BackendError) return error
  const e =
    typeof error === 'object' && error !== null
      ? (error as { code?: string; status?: number; message?: string })
      : {}
  const code = e.code ?? ''
  const message = e.message ?? 'Cloud request failed'
  if (
    [
      'LS401',
      'PGRST301',
      'PGRST302',
      'PGRST303',
      'bad_jwt',
      'session_not_found',
      'refresh_token_not_found',
      'refresh_token_already_used',
    ].includes(code) ||
    e.status === 401
  ) {
    return new BackendError('auth', message)
  }
  if (['LS403', '42501'].includes(code) || e.status === 403)
    return new BackendError('forbidden', message)
  if (
    code === 'LS400' ||
    code.startsWith('22') ||
    code.startsWith('23') ||
    e.status === 400 ||
    e.status === 422
  ) {
    return new BackendError('invalid', message)
  }
  return new BackendError('transient', message)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BackendError('transient', 'Invalid cloud response')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BackendError('transient', 'Invalid cloud response')
  return value
}
function user(value: unknown): CloudUser {
  const row = object(value)
  return { id: text(row.id), ...(typeof row.email === 'string' ? { email: row.email } : {}) }
}
function family(value: unknown): Family {
  const row = object(value)
  if (!Array.isArray(row.members)) throw new BackendError('transient', 'Invalid family response')
  return {
    id: text(row.id),
    ownerId: text(row.ownerId),
    members: row.members.map((value) => {
      const member = object(value)
      return { userId: text(member.userId), name: text(member.name) }
    }),
  }
}
function cloudRecord(value: unknown): CloudRecord {
  const row = object(value)
  try {
    if (row.kind === 'feed')
      return {
        kind: 'feed',
        record: parseAppData({ feeds: [row.record], weights: [] }).feeds[0]!,
        version: text(row.version),
      }
    if (row.kind === 'weight')
      return {
        kind: 'weight',
        record: parseAppData({ feeds: [], weights: [row.record] }).weights[0]!,
        version: text(row.version),
      }
  } catch {
    throw new BackendError('transient', 'Invalid cloud record')
  }
  throw new BackendError('transient', 'Invalid cloud record kind')
}

export function createSupabaseBackend(config: {
  url: string
  key: string
  id: string
}): CloudBackend {
  return backendFromClient(
    createClient(config.url, config.key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }),
    config.id,
  )
}

/** The SDK never escapes this module; injectable only for adapter contract tests. */
export function backendFromClient(client: SupabaseClient, id: string): CloudBackend {
  let disposed = false
  let generation = 0
  let providerSubject: string | null | undefined
  const listeners = new Set<(value: CloudUser | null) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const requests = new Set<AbortController>()
  const active = () => {
    if (disposed) throw new BackendError('transient', 'Cloud backend disposed')
  }
  const current = (revision: number) => {
    active()
    if (revision !== generation) throw new BackendError('auth', 'Authentication changed')
  }
  const invalidate = (subject: string | null) => {
    ++generation
    providerSubject = subject
    for (const request of requests) request.abort()
  }
  async function rpc(
    name: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    active()
    const revision = generation
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    requests.add(controller)
    try {
      const { data, error } = await client.rpc(name, args).abortSignal(controller.signal)
      current(revision)
      if (controller.signal.aborted) throw new BackendError('transient', 'Cloud request cancelled')
      if (error) throw error
      return data
    } catch (error) {
      throw normalizeError(error)
    } finally {
      requests.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
  function emit(value: CloudUser | null) {
    if (!disposed) for (const listener of listeners) listener(value)
  }
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    const subject = session && typeof session === 'object' && 'user' in session
      ? (session.user as { id?: unknown } | undefined)?.id
      : undefined
    const nextSubject = typeof subject === 'string' ? subject : null
    if (providerSubject !== nextSubject) invalidate(nextSubject)
    const revision = generation
    // Supabase holds its auth lock during this callback. RPC must run in another task.
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (disposed || revision !== generation) return
      if (!session) {
        emit(null)
        return
      }
      void rpc('ls_identity')
        .then((value) => {
          if (revision === generation) emit(user(value))
        })
        .catch((error: unknown) => {
          // A transient identity lookup must not masquerade as a signed-out account.
          if (revision === generation && normalizeError(error).code === 'auth') emit(null)
        })
    }, 0)
    timers.add(timer)
  })

  return {
    id,
    auth: {
      async restore() {
        active()
        const revision = generation
        try {
          if (typeof location !== 'undefined') {
            const callback = new URL(location.href)
            const fragment = new URLSearchParams(callback.hash.slice(1))
            if (callback.searchParams.has('error') || fragment.has('error')) {
              throw new BackendError('auth', 'Sign-in could not be completed. Please try again.')
            }
          }
          const { data, error } = await client.auth.getSession()
          current(revision)
          if (error) throw error
          const identity = data.session ? await rpc('ls_identity') : null
          current(revision)
          return identity === null ? null : user(identity)
        } catch (error) {
          throw normalizeError(error)
        }
      },
      async signIn(provider, redirectTo) {
        active()
        try {
          if (provider !== 'google' && provider !== 'microsoft')
            throw new BackendError('invalid', 'Unsupported sign-in provider')
          let callback: URL
          try {
            callback = new URL(redirectTo)
          } catch {
            throw new BackendError('invalid', 'Invalid sign-in callback')
          }
          if (
            !['https:', 'http:'].includes(callback.protocol) ||
            callback.username ||
            callback.password
          )
            throw new BackendError('invalid', 'Invalid sign-in callback')
          callback.search = ''
          callback.hash = ''
          const { error } = await client.auth.signInWithOAuth({
            provider: provider === 'microsoft' ? 'azure' : 'google',
            options: {
              redirectTo: callback.href,
              ...(provider === 'microsoft' ? { scopes: 'email' } : {}),
            },
          })
          active()
          if (error) throw error
        } catch (error) {
          throw normalizeError(error)
        }
      },
      async signOut() {
        active()
        invalidate(null)
        try {
          const { error } = await client.auth.signOut({ scope: 'local' })
          if (error) throw error
          emit(null)
        } catch (error) {
          throw normalizeError(error)
        }
      },
      onChange(listener) {
        active()
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    family: {
      async current() {
        const value = await rpc('ls_family_current')
        return value === null ? null : family(value)
      },
      async create() {
        return family(await rpc('ls_family_create'))
      },
      async invite(familyId): Promise<Invitation> {
        const value = object(await rpc('ls_family_invite', { p_family: familyId }))
        return { token: text(value.token), expiresAt: text(value.expiresAt) }
      },
      async revokeInvitation(familyId) {
        await rpc('ls_family_revoke_invitation', { p_family: familyId })
      },
      async join(token) {
        return family(await rpc('ls_family_join', { p_token: token }))
      },
      async leave(familyId) {
        await rpc('ls_family_leave', { p_family: familyId })
      },
      async removeMember(familyId, userId) {
        await rpc('ls_family_remove_member', { p_family: familyId, p_member: userId })
      },
      async delete(familyId) {
        await rpc('ls_family_delete', { p_family: familyId })
      },
    },
    sync: {
      async pull(familyId, cursor, page, signal): Promise<DeltaPage> {
        const value = object(
          await rpc('ls_sync_pull', { p_family: familyId, p_cursor: cursor, p_page: page }, signal),
        )
        if (!Array.isArray(value.records))
          throw new BackendError('transient', 'Invalid delta response')
        return {
          records: value.records.map(cloudRecord),
          cursor: text(value.cursor),
          nextPage: value.nextPage === null ? null : text(value.nextPage),
        }
      },
      async push(familyId, mutations: Mutation[], signal): Promise<MutationResult[]> {
        const value = await rpc(
          'ls_sync_push',
          { p_family: familyId, p_mutations: mutations },
          signal,
        )
        if (!Array.isArray(value) || value.length !== mutations.length)
          throw new BackendError('transient', 'Invalid mutation response')
        return value.map((entry, index): MutationResult => {
          const result = object(entry)
          const mutationId = text(result.mutationId)
          if (mutationId !== mutations[index]!.mutationId)
            throw new BackendError('transient', 'Mismatched mutation receipt')
          if (result.status === 'accepted')
            return { mutationId, status: 'accepted', current: cloudRecord(result.current) }
          if (result.status === 'conflict')
            return {
              mutationId,
              status: 'conflict',
              current: result.current === null ? null : cloudRecord(result.current),
            }
          throw new BackendError('transient', 'Invalid mutation status')
        })
      },
    },
    dispose() {
      if (disposed) return
      disposed = true
      ++generation
      subscription.unsubscribe()
      void client.auth.stopAutoRefresh()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const request of requests) request.abort()
      requests.clear()
      listeners.clear()
    },
  }
}
