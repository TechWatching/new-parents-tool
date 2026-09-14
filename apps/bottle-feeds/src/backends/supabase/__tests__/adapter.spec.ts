import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { backendFromClient, createSupabaseBackend, normalizeError } from '../index'
import type { Mutation } from '../../contracts'

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

const feed = {
  id: 'feed-1',
  amount: 120,
  comment: '',
  occurredAt: '2026-09-10T12:00:00Z',
  updatedAt: '2026-09-10T12:00:00Z',
}
const record = { kind: 'feed', record: feed, version: 'opaque-1' }
const normalized = {
  ...record,
  record: {
    ...feed,
    occurredAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
  },
}
const mutation: Mutation = {
  mutationId: '11111111-1111-4111-8111-111111111111',
  kind: 'feed',
  record: feed,
  baseVersion: null,
}
const family = {
  id: 'family-1',
  ownerId: 'app-owner',
  members: [{ userId: 'app-owner', name: 'Parent' }],
}

function fixture() {
  let callback: (event: string, session: unknown) => void = () => {}
  const abortSignal = vi.fn(
    async (_signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => ({
      data: null,
      error: null,
    }),
  )
  const client = {
    rpc: vi.fn(() => ({ abortSignal })),
    auth: {
      onAuthStateChange: vi.fn((cb: typeof callback) => {
        callback = cb
        return { data: { subscription: { unsubscribe } } }
      }),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: 'provider-user' } } },
        error: null,
      })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      stopAutoRefresh: vi.fn(),
    },
  }
  const unsubscribe = vi.fn()
  const backend = backendFromClient(client as unknown as SupabaseClient, 'supabase:test')
  return {
    backend,
    client,
    abortSignal,
    unsubscribe,
    event: (session: unknown, event = 'SIGNED_IN') => callback(event, session),
  }
}

let setup: ReturnType<typeof fixture>
beforeEach(() => {
  setup = fixture()
})
afterEach(() => {
  setup.backend.dispose()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Supabase CloudBackend contract', () => {
  it('constructs a PKCE client only inside its factory', () => {
    sdk.createClient.mockReturnValue(setup.client)
    const backend = createSupabaseBackend({
      url: 'https://project.supabase.co',
      key: 'public-key',
      id: 'project',
    })
    expect(sdk.createClient).toHaveBeenCalledWith('https://project.supabase.co', 'public-key', {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    backend.dispose()
  })

  it.each([
    ['google', 'google', undefined],
    ['microsoft', 'azure', 'email'],
  ] as const)(
    'maps %s OAuth and strips secrets while preserving the Pages base callback',
    async (provider, sdkProvider, scopes) => {
      await setup.backend.auth.signIn(
        provider,
        'https://example.com/new-parents-tool/?invite=secret#token',
      )
      expect(setup.client.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: sdkProvider,
        options: {
          redirectTo: 'https://example.com/new-parents-tool/',
          ...(scopes ? { scopes } : {}),
        },
      })
    },
  )

  it('restores the server-mapped app identity, never the provider subject', async () => {
    setup.abortSignal.mockResolvedValue({
      data: { id: 'app-user', email: 'parent@example.test' },
      error: null,
    })
    expect(await setup.backend.auth.restore()).toEqual({
      id: 'app-user',
      email: 'parent@example.test',
    })
    expect(setup.client.rpc).toHaveBeenCalledWith('ls_identity', {})
  })

  it.each([
    ['getSession', 'signOut'],
    ['identity RPC', 'signOut'],
    ['getSession', 'account change'],
    ['identity RPC', 'account change'],
  ])('rejects restore held in %s across %s', async (phase, transition) => {
    vi.useFakeTimers()
    setup.event({ user: { id: 'provider-user' } })
    let releaseSession!: (value: Awaited<ReturnType<typeof setup.client.auth.getSession>>) => void
    let releaseIdentity!: (value: { data: unknown; error: unknown }) => void
    if (phase === 'getSession') {
      setup.client.auth.getSession.mockReturnValue(new Promise((resolve) => { releaseSession = resolve }))
    }
    setup.abortSignal.mockReturnValue(new Promise((resolve) => { releaseIdentity = resolve }))
    const restoring = setup.backend.auth.restore()
    await Promise.resolve()
    if (transition === 'signOut') await setup.backend.auth.signOut()
    else setup.event({ user: { id: 'other-provider' } })
    if (phase === 'getSession') {
      releaseSession({ data: { session: { user: { id: 'provider-user' } } }, error: null })
      await Promise.resolve()
    }
    releaseIdentity({ data: { id: 'former-app-user' }, error: null })
    await expect(restoring).rejects.toMatchObject({ code: 'auth' })
  })

  it.each([
    ['pull', 'signOut'],
    ['family', 'signOut'],
    ['pull', 'account change'],
    ['family', 'account change'],
  ])('rejects and aborts former-subject %s across %s', async (operation, transition) => {
    vi.useFakeTimers()
    setup.event({ user: { id: 'provider-user' } })
    let release!: (value: { data: unknown; error: unknown }) => void
    setup.abortSignal.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const request = operation === 'pull'
      ? setup.backend.sync.pull('f', null, null)
      : setup.backend.family.current()
    const signal = setup.abortSignal.mock.calls[0]![0]
    if (transition === 'signOut') await setup.backend.auth.signOut()
    else setup.event({ user: { id: 'other-provider' } })
    release({ data: operation === 'pull' ? { records: [record], cursor: 'c', nextPage: null } : family, error: null })
    await expect(request).rejects.toMatchObject({ code: 'auth' })
    expect(signal.aborted).toBe(true)
  })

  it('invalidates in-flight work synchronously before the SDK sign-out finishes', async () => {
    vi.useFakeTimers()
    setup.event({ user: { id: 'provider-user' } })
    let releaseRequest!: (value: { data: unknown; error: unknown }) => void
    let releaseSignOut!: (value: { error: null }) => void
    setup.abortSignal.mockReturnValue(new Promise((resolve) => { releaseRequest = resolve }))
    setup.client.auth.signOut.mockReturnValue(new Promise((resolve) => { releaseSignOut = resolve }))
    const request = setup.backend.family.current()
    const signingOut = setup.backend.auth.signOut()
    releaseRequest({ data: family, error: null })
    await expect(request).rejects.toMatchObject({ code: 'auth' })
    expect(setup.abortSignal.mock.calls[0]![0].aborted).toBe(true)
    releaseSignOut({ error: null })
    await signingOut
  })

  it('does not invalidate same-subject work on token refresh or repeated sign-in events', async () => {
    vi.useFakeTimers()
    setup.event({ user: { id: 'provider-user' } })
    let release!: (value: { data: unknown; error: unknown }) => void
    setup.abortSignal.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const request = setup.backend.sync.pull('f', null, null)
    setup.event({ user: { id: 'provider-user' }, access_token: 'refreshed' }, 'TOKEN_REFRESHED')
    setup.event({ user: { id: 'provider-user' } }, 'SIGNED_IN')
    expect(setup.abortSignal.mock.calls[0]![0].aborted).toBe(false)
    release({ data: { records: [record], cursor: 'c', nextPage: null }, error: null })
    await expect(request).resolves.toEqual({ records: [normalized], cursor: 'c', nextPage: null })
  })

  it('reports rejected OAuth callbacks and invalid return URLs without exposing callback secrets', async () => {
    const original = location.href
    history.replaceState(
      null,
      '',
      '?error=access_denied&error_description=private-provider-details',
    )
    try {
      await expect(setup.backend.auth.restore()).rejects.toMatchObject({
        code: 'auth',
        message: 'Sign-in could not be completed. Please try again.',
      })
      expect(setup.client.rpc).not.toHaveBeenCalled()
      await expect(setup.backend.auth.signIn('google', 'not-a-url')).rejects.toMatchObject({
        code: 'invalid',
      })
      expect(setup.client.auth.signInWithOAuth).not.toHaveBeenCalled()
    } finally {
      history.replaceState(null, '', original)
    }
  })

  it('defers identity lookup outside the auth callback and emits only normalized users', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    setup.backend.auth.onChange(listener)
    setup.abortSignal.mockResolvedValue({ data: { id: 'app-user' }, error: null })
    setup.event({ user: { id: 'provider-user' } })
    expect(setup.client.rpc).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(listener).toHaveBeenCalledExactlyOnceWith({ id: 'app-user' })
  })

  it('suppresses a stale identity lookup when a later sign-out arrives', async () => {
    vi.useFakeTimers()
    let resolve!: (result: { data: unknown; error: unknown }) => void
    setup.abortSignal.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const listener = vi.fn()
    setup.backend.auth.onChange(listener)
    setup.event({ user: { id: 'old-provider-user' } })
    await vi.runAllTimersAsync()
    setup.event(null)
    await vi.runAllTimersAsync()
    resolve({ data: { id: 'old-app-user' }, error: null })
    await Promise.resolve()
    expect(listener).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('does not turn an unavailable identity bridge into a false signed-out event', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    setup.backend.auth.onChange(listener)
    setup.abortSignal.mockResolvedValue({ data: null, error: { status: 503 } })
    setup.event({ user: { id: 'provider-user' } })
    await vi.runAllTimersAsync()
    expect(listener).not.toHaveBeenCalled()
    await expect(setup.backend.auth.restore()).rejects.toMatchObject({ code: 'transient' })
  })

  it('maps every family operation without a browser-asserted actor', async () => {
    const calls: [() => Promise<unknown>, string, Record<string, unknown>, unknown][] = [
      [() => setup.backend.family.current(), 'ls_family_current', {}, family],
      [() => setup.backend.family.create(), 'ls_family_create', {}, family],
      [
        () => setup.backend.family.invite('f'),
        'ls_family_invite',
        { p_family: 'f' },
        { token: 'secret', expiresAt: '2026-09-11T12:00:00Z' },
      ],
      [
        () => setup.backend.family.revokeInvitation('f'),
        'ls_family_revoke_invitation',
        { p_family: 'f' },
        null,
      ],
      [() => setup.backend.family.join('secret'), 'ls_family_join', { p_token: 'secret' }, family],
      [() => setup.backend.family.leave('f'), 'ls_family_leave', { p_family: 'f' }, null],
      [
        () => setup.backend.family.removeMember('f', 'member'),
        'ls_family_remove_member',
        { p_family: 'f', p_member: 'member' },
        null,
      ],
      [() => setup.backend.family.delete('f'), 'ls_family_delete', { p_family: 'f' }, null],
    ]
    for (const [invoke, name, args, data] of calls) {
      setup.abortSignal.mockResolvedValue({ data, error: null })
      await invoke()
      expect(setup.client.rpc).toHaveBeenLastCalledWith(name, args)
    }
  })

  it('preserves opaque bounded pagination and validates records with legacy string IDs', async () => {
    setup.abortSignal.mockResolvedValue({
      data: { records: [record], cursor: 'opaque-frontier', nextPage: 'opaque-page' },
      error: null,
    })
    expect(await setup.backend.sync.pull('f', null, null)).toEqual({
      records: [normalized],
      cursor: 'opaque-frontier',
      nextPage: 'opaque-page',
    })
    await setup.backend.sync.pull('f', 'opaque-prior', 'opaque-page')
    expect(setup.client.rpc).toHaveBeenLastCalledWith('ls_sync_pull', {
      p_family: 'f',
      p_cursor: 'opaque-prior',
      p_page: 'opaque-page',
    })
  })

  it('sends exact immutable requests and returns accepted/conflicting CAS receipts', async () => {
    const mutations = [
      mutation,
      { ...mutation, mutationId: '22222222-2222-4222-8222-222222222222', baseVersion: 'stale' },
    ]
    setup.abortSignal.mockResolvedValue({
      data: [
        { mutationId: mutation.mutationId, status: 'accepted', current: record },
        { mutationId: mutations[1]!.mutationId, status: 'conflict', current: record },
      ],
      error: null,
    })
    expect(await setup.backend.sync.push('f', mutations)).toEqual([
      { mutationId: mutation.mutationId, status: 'accepted', current: normalized },
      { mutationId: mutations[1]!.mutationId, status: 'conflict', current: normalized },
    ])
    expect(setup.client.rpc).toHaveBeenCalledWith('ls_sync_push', {
      p_family: 'f',
      p_mutations: mutations,
    })
  })

  it('rejects success-shaped corrupt responses rather than losing unsynced records', async () => {
    setup.abortSignal.mockResolvedValue({ data: [], error: null })
    await expect(setup.backend.sync.push('f', [mutation])).rejects.toMatchObject({
      code: 'transient',
    })
    setup.abortSignal.mockResolvedValue({
      data: {
        records: [{ ...record, record: { ...feed, amount: 0 } }],
        cursor: 'c',
        nextPage: null,
      },
      error: null,
    })
    await expect(setup.backend.sync.pull('f', null, null)).rejects.toMatchObject({
      code: 'transient',
    })
  })

  it('forwards cancellation and prevents disposed backends from applying responses', async () => {
    let resolve!: (result: { data: unknown; error: unknown }) => void
    setup.abortSignal.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const controller = new AbortController()
    const request = setup.backend.sync.pull('f', null, null, controller.signal)
    controller.abort()
    expect(setup.abortSignal.mock.calls[0]![0].aborted).toBe(true)
    setup.backend.dispose()
    resolve({ data: { records: [], cursor: 'c', nextPage: null }, error: null })
    await expect(request).rejects.toMatchObject({ code: 'transient' })
    expect(setup.unsubscribe).toHaveBeenCalledOnce()
    expect(setup.client.auth.stopAutoRefresh).toHaveBeenCalledOnce()
  })

  it('cleans auth listeners and delayed identity work on disposal', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const unlisten = setup.backend.auth.onChange(listener)
    unlisten()
    setup.event({ user: { id: 'provider' } })
    setup.backend.dispose()
    await vi.runAllTimersAsync()
    expect(setup.client.rpc).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect('subscribe' in setup.backend.sync).toBe(false)
  })
})

describe('normalized backend failures', () => {
  it.each([
    [{ code: 'LS401' }, 'auth'],
    [{ status: 401 }, 'auth'],
    [{ code: 'PGRST301' }, 'auth'],
    [{ code: 'LS403' }, 'forbidden'],
    [{ code: '42501' }, 'forbidden'],
    [{ code: 'LS400' }, 'invalid'],
    [{ code: '22P02' }, 'invalid'],
    [{ code: '23505' }, 'invalid'],
    [{ status: 503 }, 'transient'],
    [new TypeError('Failed to fetch'), 'transient'],
  ])('normalizes %j as %s', (error, code) => {
    expect(normalizeError(error)).toMatchObject({ name: 'BackendError', code })
  })
})
