/**
 * Lab: Single source of truth for manager IDs
 *
 * Reads `user_manager_lists.manager_ids` from Supabase for the dedicated
 * analysis account identified by LAB_ANALYSIS_USER_ID.
 *
 * To change which managers are analysed, the operator updates their saved
 * manager IDs via the existing app UI — no code change needed.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — service-role client
 *   LAB_ANALYSIS_USER_ID                    — UUID of the dedicated analysis account
 */

import { createServiceClient } from './supabase-server.js'

export async function loadLabManagerIds(): Promise<number[]> {
  const userId = process.env['LAB_ANALYSIS_USER_ID']
  if (!userId) throw new Error('Missing env var: LAB_ANALYSIS_USER_ID')

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('user_manager_lists')
    .select('manager_ids')
    .eq('user_id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error(
        `No manager list found for LAB_ANALYSIS_USER_ID=${userId}. ` +
        'Log in to the app with the analysis account and save at least one manager ID.'
      )
    }
    throw new Error(`user_manager_lists lookup failed: ${error.message}`)
  }

  const ids: number[] = Array.isArray(data?.manager_ids) ? data.manager_ids : []

  if (ids.length === 0) {
    throw new Error(
      `Manager list for LAB_ANALYSIS_USER_ID=${userId} is empty. ` +
      'Update it via the app before running lab scripts.'
    )
  }

  console.log(`Loaded ${ids.length} manager ID(s) from user_manager_lists for user ${userId}`)
  return ids
}
