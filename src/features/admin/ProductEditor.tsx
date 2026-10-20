import { useCallback, useEffect, useRef, useState } from "react";
import { connected, rows, rpc, safeError } from "./client";
import {
  type AdminProduct,
  type AdminVariant,
  type AdminImage,
  type Inventory,
  type Movement,
  type Adjustment,
  priceCents,
  date,
} from "./model";
import { originalImagePath } from "../catalog/imageProfiles";
import { prepareImage } from "./images";
import { Confirm } from "./Confirm";
type Category = { id: string; name: string };
export function ProductEditor({
  product,
  onSaved,
  onClose,
  pending,
  onAdjust,
  onUnauthorized,
}: {
  product: AdminProduct | null;
  onSaved(p: AdminProduct): void;
  onClose(): void;
  pending: Adjustment | null;
  onAdjust(a: Adjustment): Promise<boolean>;
  onUnauthorized(): void;
}) {
  const [categories, setCategories] = useState<Category[]>([]),
    [variants, setVariants] = useState<AdminVariant[]>([]),
    [inventory, setInventory] = useState<Inventory[]>([]),
    [images, setImages] = useState<AdminImage[]>([]),
    [previews, setPreviews] = useState<Record<string, string>>({}),
    [movements, setMovements] = useState<Movement[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      text: string;
      run: () => Promise<void>;
    } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const reload = useCallback(async () => {
    const c = connected();
    const cats = await rows<Category[]>(
      c.from("categories").select("id,name").order("name"),
    );
    setCategories(cats);
    if (!product) return;
    const [vs, ims] = await Promise.all([
      rows<AdminVariant[]>(
        c
          .from("product_variants")
          .select("*")
          .eq("product_id", product.id)
          .order("sku"),
      ),
      rows<AdminImage[]>(
        c
          .from("product_images")
          .select("*")
          .eq("product_id", product.id)
          .order("position"),
      ),
    ]);
    setVariants(vs);
    setImages(ims);
    const ids = vs.map((v) => v.id);
    setInventory(
      ids.length
        ? await rows<Inventory[]>(
            c
              .from("inventory")
              .select("variant_id,on_hand,reserved")
              .in("variant_id", ids),
          )
        : [],
    );
    setMovements(
      ids.length
        ? await rows<Movement[]>(
            c
              .from("inventory_movements")
              .select(
                "id,variant_id,kind,quantity,reason,created_at,idempotency_key",
              )
              .in("variant_id", ids)
              .order("created_at", { ascending: false })
              .limit(30),
          )
        : [],
    );
    const { data, error } = await c.storage
      .from("product-images")
      .createSignedUrls(
        ims
          .filter((i) => !originalImagePath(i.storage_path))
          .map((i) => i.storage_path),
        900,
      );
    if (error) throw safeError(error);
    setPreviews(
      Object.fromEntries(
        (data ?? [])
          .filter((i) => i.path && i.signedUrl)
          .map((i) => [i.path!, i.signedUrl!]),
      ),
    );
  }, [product]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void reload()
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return;
      }
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveGallery(next: Pick<AdminImage, "storage_path" | "alt">[]) {
    if (!product) return;
    await rpc("admin_save_images", {
      p_product: product.id,
      p_expected: images,
      p_rows: next.map((i) => ({ storage_path: i.storage_path, alt: i.alt })),
    });
    await reload();
    setNotice("Galería guardada. Los originales se conservan.");
  }
  const originals = images.filter((i) => !originalImagePath(i.storage_path));
  function group(path: string) {
    return images.filter(
      (i) =>
        i.storage_path === path ||
        originalImagePath(i.storage_path)?.original === path,
    );
  }
  return (
    <>
      <div className="admin-toolbar">
        <h2 ref={heading} tabIndex={-1}>
          {product ? "Editar producto" : "Nuevo producto"}
        </h2>
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Volver a productos
        </button>
      </div>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">Procesando…</p>}
      <section className="admin-card">
        <h3>Información y precio</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            let cents: number;
            try {
              cents = priceCents(String(f.get("price")));
            } catch (e) {
              setError((e as Error).message);
              return;
            }
            const values = {
              name: String(f.get("name")).trim(),
              slug: String(f.get("slug")).trim(),
              category_id: String(f.get("category")),
              description: String(f.get("description")),
              price_cents: cents,
              active: f.get("active") === "on",
            };
            const save = async () => {
              const p = await rpc<AdminProduct>("admin_save_product", {
                p_id: product?.id ?? null,
                p_expected: product?.updated_at ?? null,
                p_values: values,
              });
              onSaved(p);
              setNotice("Información guardada.");
            };
            if (values.active !== Boolean(product?.active))
              setConfirm({
                text: values.active
                  ? "Publicar hace visible esta prenda. Comprobá fotografías y variantes."
                  : "Despublicar conserva pedidos e inventario; las URLs firmadas ya emitidas vencen en su plazo.",
                run: save,
              });
            else void run(save);
          }}
        >
          <fieldset disabled={busy}>
            <div className="admin-grid">
              <label>
                Nombre
                <input
                  name="name"
                  defaultValue={product?.name}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Slug
                <input
                  name="slug"
                  defaultValue={product?.slug}
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={150}
                />
              </label>
              <label>
                Categoría
                <select
                  name="category"
                  defaultValue={product?.category_id ?? ""}
                  required
                >
                  <option value="" disabled>
                    Seleccionar
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Precio ARS · sin miles
                <input
                  name="price"
                  inputMode="decimal"
                  defaultValue={
                    product ? String(product.price_cents / 100) : ""
                  }
                  required
                  placeholder="27000,00"
                  maxLength={14}
                />
              </label>
            </div>
            <label>
              Descripción
              <textarea
                name="description"
                defaultValue={product?.description}
                maxLength={10000}
                rows={4}
              />
            </label>
            <label className="admin-checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={product?.active}
              />
              Publicado
            </label>
            <button className="button primary">Guardar producto</button>
          </fieldset>
        </form>
      </section>
      {product && (
        <>
          <section className="admin-card">
            <div className="admin-toolbar">
              <h3>Fotografías privadas</h3>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(reload)}
              >
                Renovar vistas previas
              </button>
            </div>
            <p className="admin-muted">
              Hasta 12 fotografías, con original y tres WebP. Al retirar una
              foto se desvincula la galería; no se borra Storage.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  file = f.get("photo") as File,
                  alt = String(f.get("alt")).trim();
                void run(async () => {
                  if (originals.length >= 12)
                    throw new Error("La galería admite hasta 12 fotografías.");
                  const prepared = await prepareImage(file);
                  for (const asset of prepared) {
                    const { error } = await connected()
                      .storage.from("product-images")
                      .upload(asset.path, asset.blob, {
                        upsert: false,
                        contentType: asset.blob.type,
                        cacheControl: "3600",
                      });
                    if (error)
                      throw new Error(
                        "Carga incompleta: no se publicó la foto. Los archivos subidos se conservan privados; podés reintentar.",
                      );
                  }
                  await saveGallery([
                    ...images,
                    ...prepared.map((a) => ({ storage_path: a.path, alt })),
                  ]);
                });
              }}
            >
              <fieldset disabled={busy}>
                <div className="admin-grid">
                  <label>
                    Archivo (hasta 5 MiB)
                    <input
                      name="photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      required
                    />
                  </label>
                  <label>
                    Descripción de la imagen
                    <input name="alt" required maxLength={300} />
                  </label>
                </div>
                <button className="button secondary">
                  Preparar y cargar fotografía
                </button>
              </fieldset>
            </form>
            <div className="admin-gallery">
              {originals.map((im, index) => (
                <article key={im.id}>
                  <img
                    src={previews[im.storage_path]}
                    alt={im.alt}
                    width="240"
                    height="360"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.opacity = "0.25";
                    }}
                  />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const alt = String(
                        new FormData(e.currentTarget).get("alt"),
                      ).trim();
                      void run(() =>
                        saveGallery(
                          images.map((i) =>
                            group(im.storage_path).some((g) => g.id === i.id)
                              ? { ...i, alt }
                              : i,
                          ),
                        ),
                      );
                    }}
                  >
                    <label>
                      Texto alternativo
                      <input
                        name="alt"
                        defaultValue={im.alt}
                        required
                        maxLength={300}
                      />
                    </label>
                    <button className="button secondary" disabled={busy}>
                      Guardar texto
                    </button>
                  </form>
                  <div className="admin-actions">
                    <button
                      className="button secondary"
                      disabled={busy || index === 0}
                      onClick={() =>
                        void run(async () => {
                          const order = [...originals];
                          [order[index - 1], order[index]] = [
                            order[index],
                            order[index - 1],
                          ];
                          await saveGallery(
                            order.flatMap((i) => group(i.storage_path)),
                          );
                        })
                      }
                    >
                      Subir
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || index === originals.length - 1}
                      onClick={() =>
                        void run(async () => {
                          const order = [...originals];
                          [order[index + 1], order[index]] = [
                            order[index],
                            order[index + 1],
                          ];
                          await saveGallery(
                            order.flatMap((i) => group(i.storage_path)),
                          );
                        })
                      }
                    >
                      Bajar
                    </button>
                    <button
                      className="cart-text-button"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          text: "¿Retirar esta foto de la galería? El archivo original se conserva.",
                          run: () =>
                            saveGallery(
                              images.filter(
                                (i) =>
                                  !group(im.storage_path).some(
                                    (g) => g.id === i.id,
                                  ),
                              ),
                            ),
                        })
                      }
                    >
                      Retirar foto
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!originals.length && <p>Todavía no hay fotografías.</p>}
          </section>
          <section className="admin-card">
            <h3>Variantes</h3>
            <p className="admin-muted">
              Las altas crean inventario en cero. Se conserva el identificador
              al editar o desactivar.
            </p>
            {[...variants, null].map((v) => (
              <form
                className="admin-variant"
                key={v?.id ?? "new"}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    f = new FormData(form);
                  void run(async () => {
                    await rpc("admin_save_variant", {
                      p_id: v?.id ?? null,
                      p_product: product.id,
                      p_expected: v,
                      p_values: {
                        sku: String(f.get("sku")).trim(),
                        size: String(f.get("size")).trim(),
                        color: String(f.get("color")).trim(),
                        active: f.get("active") === "on",
                      },
                    });
                    if (!v) form.reset();
                    await reload();
                    setNotice("Variante guardada.");
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <legend>
                    {v ? `${v.sku} · ${v.size} / ${v.color}` : "Nueva variante"}
                  </legend>
                  <div className="admin-grid">
                    <label>
                      SKU
                      <input
                        name="sku"
                        defaultValue={v?.sku}
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      Talle
                      <input
                        name="size"
                        defaultValue={v?.size}
                        required
                        maxLength={30}
                      />
                    </label>
                    <label>
                      Color
                      <input
                        name="color"
                        defaultValue={v?.color}
                        required
                        maxLength={60}
                      />
                    </label>
                    <label className="admin-checkbox">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={v?.active}
                      />
                      Activa
                    </label>
                  </div>
                  <button className="button secondary">
                    {v ? "Guardar variante" : "Crear variante"}
                  </button>
                </fieldset>
              </form>
            ))}
          </section>
          <section className="admin-card">
            <h3>Inventario por variante</h3>
            <div className="admin-stock-list">
              {variants.map((v) => {
                const i = inventory.find((i) => i.variant_id === v.id);
                return (
                  <div key={v.id}>
                    <strong>
                      {v.sku} · {v.size} / {v.color}
                    </strong>
                    <p>
                      {i
                        ? `Físico: ${i.on_hand} · Reservado: ${i.reserved} · Disponible: ${i.on_hand - i.reserved}`
                        : "Inventario no disponible: revisar alta antes de ajustar."}
                    </p>
                  </div>
                );
              })}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  delta = Number(f.get("delta"));
                if (
                  !Number.isInteger(delta) ||
                  !delta ||
                  Math.abs(delta) > 1000
                ) {
                  setError(
                    "Ingresá un ajuste entero entre -1000 y 1000, distinto de cero.",
                  );
                  return;
                }
                const a = {
                  key: crypto.randomUUID(),
                  variant: String(f.get("variant")),
                  delta,
                  reason: String(f.get("reason")).trim(),
                };
                setConfirm({
                  text: `Aplicar ${delta > 0 ? "+" : ""}${delta} unidades físicas. No se modifica el stock reservado.`,
                  run: async () => {
                    await onAdjust(a);
                    await reload();
                  },
                });
              }}
            >
              <fieldset disabled={busy || Boolean(pending) || !variants.length}>
                <div className="admin-grid">
                  <label>
                    Variante a ajustar
                    <select name="variant" required>
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.sku} · {v.size} / {v.color}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ajuste de unidades
                    <input
                      name="delta"
                      type="number"
                      step="1"
                      min="-1000"
                      max="1000"
                      required
                    />
                  </label>
                  <label>
                    Motivo (sin datos personales)
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={100}
                    />
                  </label>
                </div>
                <button className="button secondary">Revisar ajuste</button>
              </fieldset>
            </form>
            <h4>Últimos movimientos</h4>
            {movements.length ? (
              <ul className="admin-movements">
                {movements.map((m) => (
                  <li key={m.id}>
                    {date(m.created_at)} ·{" "}
                    {variants.find((v) => v.id === m.variant_id)?.sku} ·{" "}
                    {m.kind} · {m.quantity} {m.reason && `· ${m.reason}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Sin movimientos.</p>
            )}
          </section>
        </>
      )}
      {confirm && (
        <Confirm
          text={confirm.text}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const fn = confirm.run;
            setConfirm(null);
            void run(fn);
          }}
        />
      )}
    </>
  );
}
