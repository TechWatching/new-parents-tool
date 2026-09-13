import type { CloudBackend } from './contracts'

function configuration() {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!rawUrl || !key || /\s/.test(key)) return null
  try {
    const url = new URL(rawUrl)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      return null
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      return null
    // Never accept a secret/service credential as browser configuration.
    if (key.startsWith('sb_secret_')) return null
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      const payload = key.split('.')[1]
      if (!payload) return null
      const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      if (
        typeof claims !== 'object' ||
        claims === null ||
        !('role' in claims) ||
        claims.role !== 'anon' ||
        key.split('.').length !== 3
      )
        return null
    }
    return { url: url.origin, key, id: `supabase:${url.origin}` }
  } catch {
    return null
  }
}

const config = configuration()
export const backendConfig: { id: string } | null = config ? { id: config.id } : null

/** Called only after cloud consent; importing this module performs no network work. */
export async function createBackend(): Promise<CloudBackend | null> {
  if (!config) return null
  const { createSupabaseBackend } = await import('./supabase')
  return createSupabaseBackend(config)
}
