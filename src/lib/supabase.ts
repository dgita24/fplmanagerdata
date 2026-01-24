import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fnehvaoqqmkrhxcqslta.supabase.co'
const supabaseAnonKey = 'sb_publishable_MWe6etLwK0ONF0hbSJX4fA_pqxUcXLK'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)