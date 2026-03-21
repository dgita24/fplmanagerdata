import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

/** How long (ms) to wait for auth to settle before concluding unauthenticated. */
const AUTH_SETTLE_TIMEOUT_MS = 3000

export interface AuthBootstrapResult {
  user: User | null
  session: Session | null
}

/** Module-level cache: once resolved within a page, reuse the same result. */
let cachedPromise: Promise<AuthBootstrapResult> | null = null

/**
 * Waits for Supabase auth to stabilise and returns a reliable auth state.
 *
 * Why this exists:
 * - `getUser()` makes a network request; on mobile PWA resume the access token
 *   may be temporarily expired and the refresh hasn't completed yet, so it
 *   returns null even though a recoverable session exists.
 * - `getSession()` reads from localStorage immediately.  If a session is
 *   present (even with an expired access token that can be refreshed) we can
 *   treat the user as authenticated — Supabase will auto-refresh in the
 *   background.
 * - If `getSession()` returns nothing, we subscribe to `onAuthStateChange`
 *   and wait up to `timeoutMs` for the client to recover a session (e.g. via
 *   a token refresh triggered by another in-flight request).
 *
 * The result is cached for the lifetime of the page so multiple callers on
 * the same page don't trigger redundant waits.
 *
 * @param timeoutMs Maximum ms to wait after a null getSession before giving up.
 */
export function awaitAuthReady(
  timeoutMs: number = AUTH_SETTLE_TIMEOUT_MS
): Promise<AuthBootstrapResult> {
  if (cachedPromise !== null) return cachedPromise

  cachedPromise = (async (): Promise<AuthBootstrapResult> => {
    // Fast path: read from localStorage (no network round-trip).
    // getSession returns a session even if the access token is expired, as
    // long as a refresh token exists — that is sufficient to treat the user
    // as authenticated; Supabase will refresh automatically.
    const { data: { session }, error } = await supabase.auth.getSession()

    if (session) {
      return { user: session.user, session }
    }

    if (error) {
      console.warn('[authBootstrap] getSession error:', error.message)
    }

    // Slow path: no cached session found. Wait briefly for the auth client
    // to fire an INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED event, which
    // can happen during PWA resume while a token refresh is in-flight.
    return new Promise<AuthBootstrapResult>((resolve) => {
      let settled = false

      const done = (result: AuthBootstrapResult) => {
        if (settled) return
        settled = true
        clearTimeout(tid)
        sub.unsubscribe()
        resolve(result)
      }

      const tid = setTimeout(() => {
        done({ user: null, session: null })
      }, timeoutMs)

      const { data: { subscription: sub } } = supabase.auth.onAuthStateChange(
        (event, s) => {
          if (
            event === 'INITIAL_SESSION' ||
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED'
          ) {
            done({ user: s?.user ?? null, session: s ?? null })
          } else if (event === 'SIGNED_OUT') {
            done({ user: null, session: null })
          }
        }
      )
    })
  })()

  return cachedPromise
}

/**
 * Resets the cached bootstrap promise.
 * Call this after an explicit sign-in or sign-out so the next `awaitAuthReady`
 * re-evaluates auth state from scratch.
 */
export function resetAuthBootstrap(): void {
  cachedPromise = null
}
