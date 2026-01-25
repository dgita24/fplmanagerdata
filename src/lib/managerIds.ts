import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://fnehvaoqqmkrhxcqslta.supabase.co',
  'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'
)

export async function checkAuthAndGetManagerIds() {
  // Check if user is logged in
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (!user) {
    return { authenticated: false, user: null, managerIds: [] }
  }
  
  // Get manager IDs from Supabase
  try {
    const { data, error } = await supabase
      .from('user_manager_lists')
      .select('manager_ids')
      .eq('user_id', user.id)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error loading manager IDs:', error)
      return { authenticated: true, user, managerIds: [] }
    }
    
    const managerIds = data?.manager_ids || []
    
    return { authenticated: true, user, managerIds }
  } catch (e) {
    console.error('Error:', e)
    return { authenticated: true, user, managerIds: [] }
  }
}