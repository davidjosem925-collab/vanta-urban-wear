type PublicEnv = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }
export function readPublicSupabaseConfig(env: PublicEnv) {
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !key) return null
  if (!url || !key) throw new Error('Configurá ambas variables públicas de Supabase.')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL de Supabase inválida.')
  if (key.startsWith('sb_secret_')) throw new Error('No se permiten claves secretas en frontend.')
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
      if (payload.role !== 'anon') throw new Error('Solo se permite la clave pública anon.')
    } catch { throw new Error('Clave pública JWT inválida o privilegiada.') }
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Usá una clave pública de Supabase.')
  return { url, key }
}
