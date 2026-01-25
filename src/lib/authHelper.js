import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://fnehvaoqqmkrhxcqslta.supabase.co',
  'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'
)

/**
 * Check if user is authenticated and load their manager IDs from Supabase
 * @returns {Promise<{authenticated: boolean, managerIds: number[]}>}
 */
export async function loadManagerIdsFromSupabase() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      // Not authenticated - redirect to login
      window.location.href = '/login'
      return { authenticated: false, managerIds: [] }
    }
    
    // Load manager IDs from Supabase
    const { data, error } = await supabase
      .from('user_manager_lists')
      .select('manager_ids')
      .eq('user_id', user.id)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error loading manager IDs:', error)
      return { authenticated: true, managerIds: [] }
    }
    
    const managerIds = data?.manager_ids || []
    
    return { authenticated: true, managerIds }
  } catch (e) {
    console.error('Error in loadManagerIdsFromSupabase:', e)
    return { authenticated: false, managerIds: [] }
  }
}