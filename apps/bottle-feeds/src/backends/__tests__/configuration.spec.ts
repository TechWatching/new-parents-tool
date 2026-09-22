import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const create = vi.hoisted(() => vi.fn(() => ({ id: 'adapter' })))
vi.mock('../supabase', () => ({ createSupabaseBackend: create }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  create.mockClear()
})

describe('optional cloud composition', () => {
  it.each([
    [undefined, undefined],
    ['', ''],
    ['  ', 'sb_publishable_public'],
    ['https://project.supabase.co', undefined],
    ['not a URL', 'sb_publishable_public'],
    ['ftp://project.supabase.co', 'sb_publishable_public'],
    ['https://project.supabase.co', 'bad key'],
    ['https://project.supabase.co', 'placeholder'],
    ['https://project.supabase.co', 'sb_secret_no_browser_secrets'],
    ['https://user:password@project.supabase.co', 'sb_publishable_public'],
  ])('disables unusable configuration without constructing a client: %s', async (url, key) => {
    vi.stubEnv('VITE_SUPABASE_URL', url)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key)
    const module = await import('../index')
    expect(module.backendConfig).toBeNull()
    expect(await module.createBackend()).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('defers SDK construction until consent and uses deployment—not credential—identity', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://project.supabase.co/ ')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_first')
    const first = await import('../index')
    expect(first.backendConfig).toEqual({ id: 'supabase:https://project.supabase.co' })
    expect(create).not.toHaveBeenCalled()
    await first.createBackend()
    expect(create).toHaveBeenCalledWith({
      id: first.backendConfig!.id,
      url: 'https://project.supabase.co',
      key: 'sb_publishable_first',
    })
    vi.resetModules()
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_rotated')
    expect((await import('../index')).backendConfig).toEqual(first.backendConfig)
  })

  it('accepts legacy anon JWTs but rejects service-role JWTs', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`,
    )
    expect((await import('../index')).backendConfig).not.toBeNull()
    vi.resetModules()
    vi.stubEnv(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`,
    )
    expect((await import('../index')).backendConfig).toBeNull()
  })
})
