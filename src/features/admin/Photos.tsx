import { useRef, useState } from "react";
import type { AdminImage, AdminProduct } from "./model";
import type { ProductData } from "./useProductData";
import type { Execute } from "./ProductEditor";
import { rpc } from "./client";
import { connected } from "./client";
import { originalImagePath } from "../catalog/imageProfiles";
import { originals } from "./ux";
import { prepareImage } from "./images";
export type RequestConfirm = (value: {
  text: string;
  run: () => Promise<void>;
}) => void;
export function Photos({
  product,
  data,
  busy,
  execute,
  refresh,
  onDirty,
  success,
  confirm,
}: {
  product: AdminProduct;
  data: ProductData;
  busy: boolean;
  execute: Execute;
  refresh(): Promise<boolean>;
  onDirty(v: boolean): void;
  success(t: string): void;
  confirm: RequestConfirm;
}) {
  const [alts, setAlts] = useState<Record<string, string>>({}),
    [fileDirty, setFileDirty] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const photos = originals(data.images);
  const group = (path: string) =>
    data.images.filter(
      (i) =>
        i.storage_path === path ||
        originalImagePath(i.storage_path)?.original === path,
    );
  async function save(next: Pick<AdminImage, "storage_path" | "alt">[]) {
    await rpc("admin_save_images", {
      p_product: product.id,
      p_expected: data.images,
      p_rows: next.map((i) => ({ storage_path: i.storage_path, alt: i.alt })),
    });
    success(
      "Fotografías guardadas correctamente. Los archivos originales se conservan.",
    );
  }
  function clearAlt(path: string) {
    const next = { ...alts };
    delete next[path];
    setAlts(next);
    onDirty(fileDirty || Object.keys(next).length > 0);
  }
  return (
    <section className="admin-card">
      <div className="admin-toolbar">
        <div>
          <h3>Fotografías</h3>
          <p className="admin-muted">
            La primera foto es la imagen principal de tu prenda.
          </p>
        </div>
        <button
          className="admin-text-action"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Renovar vistas previas
        </button>
      </div>
      <div className="admin-gallery">
        {photos.map((im, index) => (
          <article className="admin-photo-card" key={im.storage_path}>
            <div className="admin-photo-frame">
              {data.previews[im.storage_path] ? (
                <img
                  src={data.previews[im.storage_path]}
                  alt={im.alt}
                  width="240"
                  height="300"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
              ) : (
                <span>Vista previa no disponible</span>
              )}
              <span className="admin-photo-index">
                {index === 0 ? "Imagen principal" : `Foto ${index + 1}`}
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void execute(async () => {
                  const alt = (alts[im.storage_path] ?? im.alt).trim();
                  await save(
                    data.images.map((i) =>
                      group(im.storage_path).some((g) => g.id === i.id)
                        ? { ...i, alt }
                        : i,
                    ),
                  );
                  clearAlt(im.storage_path);
                  await refresh();
                });
              }}
            >
              <label>
                Descripción de la foto
                <input
                  value={alts[im.storage_path] ?? im.alt}
                  onChange={(e) => {
                    setAlts({ ...alts, [im.storage_path]: e.target.value });
                    onDirty(true);
                  }}
                  required
                  maxLength={300}
                  aria-label={`Descripción de foto ${index + 1}`}
                />
              </label>
              <button
                className="admin-text-action"
                disabled={busy || alts[im.storage_path] === undefined}
              >
                Guardar descripción
              </button>
            </form>
            <div className="admin-photo-actions">
              <button
                className="button secondary"
                aria-label={`Mover foto ${index + 1} antes`}
                disabled={busy || index === 0}
                onClick={() =>
                  void execute(async () => {
                    const order = [...photos];
                    [order[index - 1], order[index]] = [
                      order[index],
                      order[index - 1],
                    ];
                    await save(order.flatMap((i) => group(i.storage_path)));
                    await refresh();
                  })
                }
              >
                ← Antes
              </button>
              <button
                className="button secondary"
                aria-label={`Mover foto ${index + 1} después`}
                disabled={busy || index === photos.length - 1}
                onClick={() =>
                  void execute(async () => {
                    const order = [...photos];
                    [order[index + 1], order[index]] = [
                      order[index],
                      order[index + 1],
                    ];
                    await save(order.flatMap((i) => group(i.storage_path)));
                    await refresh();
                  })
                }
              >
                Después →
              </button>
              <button
                className="admin-text-action"
                disabled={busy}
                onClick={() =>
                  confirm({
                    text: "¿Retirar esta fotografía de la galería? El archivo original se conserva.",
                    run: async () => {
                      await save(
                        data.images.filter(
                          (i) =>
                            !group(im.storage_path).some((g) => g.id === i.id),
                        ),
                      );
                      clearAlt(im.storage_path);
                      await refresh();
                    },
                  })
                }
              >
                Retirar foto {index + 1}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!photos.length && (
        <div className="admin-empty">
          <span className="admin-empty-symbol" aria-hidden="true">
            ＋
          </span>
          <h4>Mostrá tu prenda</h4>
          <p>Agregá su primera fotografía. Después podrás cambiar el orden.</p>
        </div>
      )}
      <form
        className="admin-upload"
        ref={form}
        onChange={() => {
          setFileDirty(true);
          onDirty(true);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            file = f.get("photo") as File,
            alt = String(f.get("alt")).trim();
          void execute(async () => {
            if (photos.length >= 12)
              throw new Error("La galería admite hasta 12 fotografías.");
            setProgress(0);
            try {
              const prepared = await prepareImage(file);
              for (let i = 0; i < prepared.length; i++) {
                const asset = prepared[i];
                const { error } = await connected()
                  .storage.from("product-images")
                  .upload(asset.path, asset.blob, {
                    upsert: false,
                    contentType: asset.blob.type,
                    cacheControl: "3600",
                  });
                if (error)
                  throw new Error(
                    "La fotografía no se vinculó: la carga quedó incompleta. Podés volver a intentarlo. Los archivos subidos siguen privados.",
                  );
                setProgress(i + 1);
              }
              await save([
                ...data.images,
                ...prepared.map((a) => ({ storage_path: a.path, alt })),
              ]);
              form.current?.reset();
              setFileDirty(false);
              onDirty(Object.keys(alts).length > 0);
              await refresh();
            } finally {
              setProgress(null);
            }
          });
        }}
      >
        <h4>Agregar fotografía</h4>
        <p className="admin-muted">
          Hasta 12 fotos. JPEG, PNG, WebP o AVIF de hasta 5 MB. Preparamos las
          versiones livianas por vos.
        </p>
        <fieldset disabled={busy || photos.length >= 12}>
          <div className="admin-grid">
            <label>
              Elegí una fotografía
              <input
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                required
              />
            </label>
            <label>
              Descripción de la imagen
              <input
                name="alt"
                aria-label="Descripción de la imagen"
                aria-describedby="admin-photo-help"
                placeholder="Ej.: Remera hueso, vista frontal"
                required
                maxLength={300}
              />
              <span id="admin-photo-help" className="admin-field-help">
                Ayuda a quienes usan lectores de pantalla.
              </span>
            </label>
          </div>
          <button className="button primary">
            {progress === null ? "Subir fotografía" : "Subiendo fotografía…"}
          </button>
        </fieldset>
        {progress !== null && (
          <div role="status">
            <p>
              {progress === 0
                ? "Preparando la fotografía…"
                : `Cargando archivos: ${progress} de 4`}
            </p>
            <progress
              max={4}
              value={progress}
              aria-label="Archivos de la fotografía cargados"
            />
          </div>
        )}
      </form>
    </section>
  );
}
