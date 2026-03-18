/**
 * Service-role Supabase client for private-lab scripts.
 *
 * NEVER import this from public/browser code.
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (service role bypasses RLS).
 *
 * Usage in scripts:
 *   import { getServiceClient } from '../../lib/private-lab/supabase-service.js';
 *   const supabase = getServiceClient();
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
        'These should never be committed to source code — use a .env file or CI secrets.',
    );
  }

  _client = createClient(url, key, {
    auth: {
      // Disable auto session refresh — scripts are short-lived processes
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}
