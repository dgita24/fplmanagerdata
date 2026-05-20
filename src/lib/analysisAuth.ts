import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export async function checkAnalysisLabAccess(user: User | null): Promise<boolean> {
  if (!user) return false

  try {
    const { data, error } = await supabase
      .from('analysis_lab_access')
      .select('user_id')
      .eq('user_id', user.id)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking analysis lab access:', error)
      return false
    }

    return Boolean(data?.user_id)
  } catch (e) {
    console.error('Error checking analysis lab access:', e)
    return false
  }
}
