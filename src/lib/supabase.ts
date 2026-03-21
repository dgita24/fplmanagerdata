import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fnehvaoqqmkrhxcqslta.supabase.co'
const supabaseAnonKey = 'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'

// Migrate any session stored under the old custom key ('fpl-auth') to the
// Supabase default key so returning users are not silently logged out.
// This runs once on client load, before the client is created.
if (typeof window !== 'undefined') {
  const OLD_KEY = 'fpl-auth'
  const DEFAULT_KEY = 'sb-fnehvaoqqmkrhxcqslta-auth-token'
  try {
    const oldSession = window.localStorage.getItem(OLD_KEY)
    const newSession = window.localStorage.getItem(DEFAULT_KEY)
    if (oldSession && !newSession) {
      // Copy to the default key so the new client can pick it up
      window.localStorage.setItem(DEFAULT_KEY, oldSession)
    }
    if (oldSession) {
      // Always clean up the old key to avoid stale data
      window.localStorage.removeItem(OLD_KEY)
    }
  } catch {
    // localStorage may be unavailable in some contexts — ignore silently
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,
  },
})