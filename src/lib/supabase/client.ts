import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { readPublicSupabaseConfig } from "./config";

// Configuration errors must not crash the whole storefront at import time.
function configure() {
  try {
    const config = readPublicSupabaseConfig(import.meta.env);
    if (!config)
      return {
        client: null,
        error:
          "El catálogo todavía no está conectado. Volvé a visitarnos pronto.",
      };
    return {
      client: createClient<Database>(config.url, config.key, {
        // Storefront is always anonymous, including on browsers used by an admin.
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
      error: null,
    };
  } catch {
    return {
      client: null,
      error: "La colección está en preparación. Volvé a visitarnos pronto.",
    };
  }
}
const configuration = configure();
export const supabase = configuration.client;
export const supabaseConfigurationError = configuration.error;
