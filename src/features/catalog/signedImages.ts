import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";

const LIFETIME = 900;
const CACHE_MS = (LIFETIME - 60) * 1000;
const MAX_CACHE = 256;
/** Scoped to one anonymous service instance; tokens never enter persistent storage. */
export function signedImages(client: SupabaseClient<Database> | null) {
  const cache = new Map<string, { url: string; expires: number }>();
  const pending = new Map<string, Promise<string | null>>();
  return async function sign(
    paths: string[],
    force = false,
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(paths)];
    const now = Date.now();
    for (const [path, value] of cache)
      if (value.expires <= now) cache.delete(path);
    if (force) for (const path of unique) cache.delete(path);
    const missing = unique.filter(
      (path) => !cache.has(path) && !pending.has(path),
    );
    if (missing.length) {
      const request = Promise.resolve()
        .then(async () => {
          if (!client) return new Map<string, string>();
          const { data, error } = await client.storage
            .from("product-images")
            .createSignedUrls(missing, LIFETIME);
          return error
            ? new Map<string, string>()
            : new Map(
                (data ?? [])
                  .filter((item) => item.path && item.signedUrl && !item.error)
                  .map((item) => [item.path!, item.signedUrl]),
              );
        })
        .catch(() => new Map<string, string>());
      for (const path of missing) {
        const value = request
          .then((urls) => {
            const url = urls.get(path) ?? null;
            if (url) {
              cache.set(path, { url, expires: now + CACHE_MS });
              while (cache.size > MAX_CACHE)
                cache.delete(cache.keys().next().value!);
            }
            return url;
          })
          .finally(() => pending.delete(path));
        pending.set(path, value);
      }
    }
    return new Map(
      await Promise.all(
        unique.map(
          async (path) =>
            [
              path,
              cache.get(path)?.url ?? (await pending.get(path)) ?? null,
            ] as const,
        ),
      ),
    );
  };
}
