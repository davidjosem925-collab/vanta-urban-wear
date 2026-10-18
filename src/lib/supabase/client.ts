import { createClient } from '@supabase/supabase-js'
import { readPublicSupabaseConfig } from './config'
const config = readPublicSupabaseConfig(import.meta.env)
// Ausencia de configuración es válida para la pantalla inicial local.
export const supabase = config ? createClient(config.url, config.key) : null
