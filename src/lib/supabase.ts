import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fnehvaoqqmkrhxcqslta.supabase.co'
const supabaseAnonKey = 'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'

// Migrate any session stored under the old custom key to the Supabase default key.
// Safe/idempotent: only runs in the browser, only copies if the default slot is empty.
if (typeof window !== 'undefined') {
  try {
    const OLD_KEY = 'fpl-auth'
    const DEFAULT_KEY = 'sb-fnehvaoqqmkrhxcqslta-auth-token'
    const old = window.localStorage.getItem(OLD_KEY)
    if (old !== null) {
      if (window.localStorage.getItem(DEFAULT_KEY) === null) {
        window.localStorage.setItem(DEFAULT_KEY, old)
      }
      window.localStorage.removeItem(OLD_KEY)
    }
  } catch (_) {
    // localStorage may be unavailable (e.g. private browsing) — safe to ignore
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,
  },
})