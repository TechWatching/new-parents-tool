import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** True when both Supabase environment variables are present. */
export const isSupabaseConfigured: boolean = Boolean(url && key)

/**
 * Supabase client instance, or null when not configured.
 * Only the publishable (anon) key is used here; it is safe to expose in
 * client-side code. Row Level Security is the authorization boundary.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null
