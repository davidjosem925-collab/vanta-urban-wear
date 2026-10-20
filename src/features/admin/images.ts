import { imageProfiles, optimizedPath } from "../catalog/imageProfiles";
export function validImageHeader(type: string, b: Uint8Array) {
  const ascii = (a: number, z: number) => String.fromCharCode(...b.slice(a, z));
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v);
  if (type === "image/jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (type === "image/webp")
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (type === "image/avif")
    return ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 64));
  return false;
}
export async function prepareImage(
  file: File,
): Promise<{ path: string; blob: Blob }[]> {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
      file.type,
    ) ||
    file.size > 5242880 ||
    !file.size
  )
    throw new Error("Usá JPEG, PNG, WebP o AVIF de hasta 5 MiB.");
  if (
    !validImageHeader(
      file.type,
      new Uint8Array(await file.slice(0, 64).arrayBuffer()),
    )
  )
    throw new Error(
      "El contenido no coincide con el formato de imagen indicado.",
    );
  const url = URL.createObjectURL(file),
    img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("El archivo no es una imagen válida."));
      img.src = url;
    });
    if (
      !img.naturalWidth ||
      !img.naturalHeight ||
      img.naturalWidth * img.naturalHeight > 40000000
    )
      throw new Error("La imagen supera 40 megapíxeles o es inválida.");
    const ext =
      file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `vanta-admin/${crypto.randomUUID()}/front.${ext}`;
    const result = [{ path, blob: file as Blob }];
    for (const [profile, p] of Object.entries(imageProfiles)) {
      const ratio = Math.min(
          1,
          p.width / img.naturalWidth,
          p.height / img.naturalHeight,
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo preparar la fotografía.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b && b.type === "image/webp"
              ? resolve(b)
              : reject(
                  new Error(
                    "Este navegador no puede generar WebP. Usá un navegador actualizado.",
                  ),
                ),
          "image/webp",
          p.quality / 100,
        ),
      );
      result.push({
        path: optimizedPath(path, profile as keyof typeof imageProfiles),
        blob,
      });
    }
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
