/** Offline only. Never connects to Storage or SQL; originals remain byte-for-byte intact. */
import sharp from "sharp";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { generatedImageFile, sameGeneratedText } from "./generated-image-file.mjs";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  PROJECT_REF,
  selectCatalog,
  imageBytes,
  hash,
  id,
} from "./demo-catalog.mjs";
import {
  imageProfiles,
  optimizedPath,
} from "../src/features/catalog/imageProfiles.ts";

export const OUTPUT = resolve(ROOT, "supabase/seeds/optimized");
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export function metadataSql(records, confirmation = "PENDIENTE_DE_APROBACION") {
  const values = records
    .map(
      (r) =>
        `(${quote(r.id)}::uuid, ${quote(r.product_id)}::uuid, ${quote(r.original_id)}::uuid, ${quote(r.original)}, ${quote(r.storage_path)}, ${quote(r.alt)}, ${r.position})`,
    )
    .join(",\n");
  return `-- PREPARADO OFFLINE. NO EJECUTAR SIN APROBAR FOTOS Y 36 METADATOS NUEVOS.\n-- Proyecto exclusivo: ${PROJECT_REF}. Primero subir WebP sin sobrescribir.\n-- En SQL Editor, seleccionar este proyecto y ejecutar TODO el bloque.\n-- Requiere generar un archivo confirmado con --confirm-project.\ndo $vanta$\ndeclare confirmation text := ${quote(confirmation)};\nbegin\n  if confirmation <> '${PROJECT_REF}' then raise exception 'Carga pendiente de aprobación del proyecto VANTA'; end if;\n  if not exists(select 1 from storage.buckets where id='product-images' and not public and 'image/webp'=any(allowed_mime_types)) then raise exception 'Bucket privado WebP requerido'; end if;\n  lock table public.product_images in share row exclusive mode;\n  if exists(\n    select 1 from (values\n${values}\n    ) d(id,product_id,original_id,original,storage_path,alt,position)\n    where not exists(select 1 from public.product_images i join public.products p on p.id=i.product_id where i.id=d.original_id and i.product_id=d.product_id and i.storage_path=d.original and p.active)\n       or not exists(select 1 from storage.objects o where o.bucket_id='product-images' and o.name=d.storage_path)\n       or exists(select 1 from public.product_images i where (i.id=d.id or i.storage_path=d.storage_path) and (i.id<>d.id or i.product_id<>d.product_id or i.storage_path<>d.storage_path or i.alt<>d.alt or i.position<>d.position))\n  ) then raise exception 'Original, archivo optimizado o identidad incompatible: no se modificó nada'; end if;\n  insert into public.product_images(id,product_id,storage_path,alt,position)\n  select d.id,d.product_id,d.storage_path,d.alt,d.position from (values\n${values}\n  ) d(id,product_id,original_id,original,storage_path,alt,position) on conflict(id) do nothing;\nend\n$vanta$;\n-- Solo agrega metadatos nuevos; no cambia originales, productos ni RLS.\n`;
}
export async function prepareImages(check = false, output = OUTPUT) {
  const data = selectCatalog();
  const records = [];
  for (const product of data.products) {
    const original = imageBytes(product);
    for (const [profile, settings] of Object.entries(imageProfiles)) {
      const encoded = await sharp(original)
        .rotate()
        .resize({
          width: settings.width,
          height: settings.height,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: settings.quality, effort: 6 })
        .toBuffer({ resolveWithObject: true });
      if (encoded.data.length >= original.length)
        throw new Error("La optimización debe reducir bytes.");
      const storage_path = optimizedPath(product.image.storage_path, profile);
      const record = {
        id: id("optimized:" + storage_path, "vanta-webp-v1"),
        product_id: product.id,
        original_id: product.image.id,
        original: product.image.storage_path,
        storage_path,
        profile,
        width: encoded.info.width,
        height: encoded.info.height,
        quality: settings.quality,
        bytes: encoded.data.length,
        original_bytes: original.length,
        sha256: hash(encoded.data),
        alt: product.image.alt,
        position: 10000 + Object.keys(imageProfiles).indexOf(profile),
      };
      const target = resolve(output, storage_path);
      await generatedImageFile(target, encoded.data, { check });
      records.push(record);
    }
  }
  const manifest =
    JSON.stringify(
      {
        version: "vanta-webp-v1",
        project_ref: PROJECT_REF,
        bucket: "product-images",
        records,
      },
      null,
      2,
    ) + "\n";
  const sql = metadataSql(records);
  for (const [filename, text] of [
    ["manifest.json", manifest],
    ["link-images.pending.sql", sql],
  ]) {
    await generatedImageFile(resolve(output, filename), text, { check, text: true });
  }
  return records;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    const confirmation = args
      .find((a) => a.startsWith("--confirm-project="))
      ?.slice("--confirm-project=".length);
    if (
      args.some(
        (a) => a !== "--check" && !a.startsWith("--confirm-project="),
      ) ||
      (confirmation !== undefined &&
        (confirmation !== PROJECT_REF || args.includes("--check")))
    )
      throw new Error("Confirmación o argumentos inválidos.");
    const records = await prepareImages(args.includes("--check"));
    if (confirmation) {
      const work = resolve(ROOT, "work");
      try {
        if ((await lstat(work)).isSymbolicLink())
          throw new Error("No se permiten enlaces simbólicos.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await mkdir(work, { recursive: true });
      const target = resolve(work, "vanta-images-link-v1.sql");
      const sql = metadataSql(records, confirmation);
      try {
        await writeFile(target, sql, { flag: "wx" });
      } catch (error) {
        if (
          error.code !== "EEXIST" ||
          (await lstat(target)).isSymbolicLink() ||
          !sameGeneratedText(await readFile(target, "utf8"), sql)
        )
          throw error;
      }
      console.log(
        "SQL confirmado preparado en work/vanta-images-link-v1.sql; no se ejecutó.",
      );
    }
    console.log(
      `OK offline: ${records.length} WebP; ${records.reduce((n, r) => n + r.bytes, 0)} bytes. Originales conservados. Sin conexión ni carga remota.`,
    );
  } catch (error) {
    console.error(
      `Preparación incompleta: ${error instanceof Error ? error.message : "revisar originales y archivos optimizados"} Sin operaciones remotas.`,
    );
    process.exitCode = 1;
  }
}
