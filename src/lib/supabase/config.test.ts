import { describe, expect, it } from 'vitest'
import { readPublicSupabaseConfig as read } from './config'
describe('configuración pública', () => {
  it('permite iniciar sin credenciales', () => expect(read({})).toBeNull())
  it('rechaza configuración parcial', () => expect(() => read({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toThrow())
  it('acepta clave publicable', () => expect(read({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' })?.url).toContain('https:'))
  it('rechaza secretos', () => expect(() => read({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' })).toThrow())
  it('rechaza JWT service role', () => expect(() => read({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: `a.${btoa(JSON.stringify({role:'service_role'}))}.b` })).toThrow())
})
