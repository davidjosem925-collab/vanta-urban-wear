import { connected } from "./client";
import type { AdminImage } from "./model";
import { originalImagePath, optimizedPath } from "../catalog/imageProfiles";
const cache = new Map<string, { url: string; until: number }>();
export function clearAdminPreviews() {
  cache.clear();
}
export async function imagePreviews(images: AdminImage[]) {
  const paths = images
    .filter((i) => !originalImagePath(i.storage_path))
    .map((i) => {
      const thumb = optimizedPath(i.storage_path, "thumb");
      return {
        original: i.storage_path,
        path: images.some((x) => x.storage_path === thumb)
          ? thumb
          : i.storage_path,
      };
    });
  const missing = [
    ...new Set(
      paths
        .filter(
          (p) => !cache.has(p.path) || cache.get(p.path)!.until <= Date.now(),
        )
        .map((p) => p.path),
    ),
  ];
  if (missing.length) {
    const { data, error } = await connected()
      .storage.from("product-images")
      .createSignedUrls(missing, 900);
    if (error)
      throw new Error(
        "No se pudieron cargar las fotografías. Volvé a consultar para renovar las vistas previas.",
      );
    for (const p of data ?? [])
      if (p.path && p.signedUrl)
        cache.set(p.path, { url: p.signedUrl, until: Date.now() + 840000 });
  }
  return Object.fromEntries(
    paths.map((p) => [p.original, cache.get(p.path)?.url ?? ""]),
  );
}
