/** Optional read-only live smoke check. Never prints keys, rows or signed URLs. */
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";
import { readPublicSupabaseConfig } from "../src/lib/supabase/config.ts";

try {
  const env = {
    ...loadEnv("development", process.cwd(), "VITE_"),
    ...process.env,
  };
  const config = readPublicSupabaseConfig(env);
  if (!config)
    throw new Error("Configurá las dos variables públicas en .env.local.");
  const client = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
    },
  });
  let failed = false;
  for (const table of [
    "categories",
    "products",
    "product_images",
    "product_variants",
  ]) {
    let query = client.from(table).select("id", { count: "exact", head: true });
    if (table !== "product_images") query = query.eq("active", true);
    const { count, error } = await query;
    if (error) failed = true;
    console.log(
      `${table}: ${error ? "ERROR de lectura (revisar configuración, conectividad y RLS)" : `OK, ${count ?? 0} filas visibles`}`,
    );
  }
  const { data: image, error } = await client
    .from("product_images")
    .select("storage_path")
    .limit(1)
    .maybeSingle();
  if (error) {
    failed = true;
    console.log("Storage: no se pudo obtener una imagen visible.");
  } else if (image) {
    const { error: signingError } = await client.storage
      .from("product-images")
      .createSignedUrl(image.storage_path, 60);
    if (signingError) failed = true;
    console.log(
      `Storage privado: ${signingError ? "ERROR al firmar imagen" : "OK, URL de lectura firmada (no mostrada)"}`,
    );
  } else console.log("Storage: sin imágenes visibles para verificar la firma.");
  if (failed) process.exitCode = 1;
} catch {
  console.error(
    "Verificación incompleta. Revisá las dos variables públicas, la clave publicable y la conectividad. No se mostraron credenciales.",
  );
  process.exitCode = 1;
}
