import { supabase } from './supabase'

export async function checkAuthAndGetManagerIds() {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (!user) {
    return { authenticated: false, user: null, managerIds: [] }
  }
  
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