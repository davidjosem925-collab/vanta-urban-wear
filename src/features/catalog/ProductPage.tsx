import { useCallback, useState } from "react";
import { Feedback, Loading } from "../../components/Feedback";
import { Photo } from "../../components/Photo";
import { formatARS, orderedSizes, selectedVariant } from "./model";
import type { CatalogProduct, CatalogService } from "./service";
import { useAsync } from "./useAsync";
import { SizeGuide } from "./SizeGuide";
import { AddToCart } from "../cart/AddToCart";

function ProductDetail({
  product,
  service,
}: {
  product: CatalogProduct;
  service: CatalogService;
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const colors = [...new Set(product.variants.map((v) => v.color))];
  const sizes = orderedSizes(product.variants.map((v) => v.size));
  const variant = selectedVariant(product.variants, color, size);
  function selectColor(value: string) {
    setColor(value);
    if (!selectedVariant(product.variants, value, size)) setSize("");
  }
  return (
    <>
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <a href="#/">Inicio</a>
        <span aria-hidden="true">/</span>
        <a href="#/catalogo">Colección</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <div className="product-detail">
        <section className="gallery" aria-label={`Galería de ${product.name}`}>
          <div className="gallery-main">
            <Photo
              key={product.images[activeImage]?.id ?? "empty"}
              image={product.images[activeImage]}
              service={service}
              eager
              allowRetry
            />
          </div>
          {product.images.length > 1 && (
            <div className="gallery-thumbs">
              {product.images.map((image, index) => (
                <button
                  key={image.id}
                  className="gallery-thumb"
                  aria-label={`Ver imagen ${index + 1} de ${product.name}`}
                  aria-pressed={index === activeImage}
                  onClick={() => setActiveImage(index)}
                >
                  <Photo key={image.id} image={image} service={service} profile="thumb" />
                </button>
              ))}
            </div>
          )}
        </section>
        <div className="detail-copy">
          <p className="eyebrow">VANTA / URBAN ESSENTIALS</p>
          <h1>{product.name}</h1>
          <p className="detail-price">
            {formatARS(product.price_cents)} <small>ARS</small>
          </p>
          <p className="transfer-note">
            Precio por transferencia: a confirmar. No hay un descuento
            publicado.
          </p>
          <p className="product-description">
            {product.description ||
              "Una pieza del universo VANTA. Más información próximamente."}
          </p>
          {product.variants.length > 0 && (
            <fieldset className="variant-options">
              <legend>
                Color <span>{color || "Seleccioná una opción"}</span>
              </legend>
              <div>
                {colors.map((value) => (
                  <button
                    key={value}
                    className="option"
                    aria-pressed={color === value}
                    onClick={() => selectColor(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="variant-options">
            <legend className="size-legend">
              <span className="size-heading">
                <span className="size-label">
                  Talle <span>{size || "Seleccioná una opción"}</span>
                </span>
                <SizeGuide categoryId={product.category_id} service={service} />
              </span>
            </legend>
            <div>
              {sizes.map((value) => (
                <button
                  key={value}
                  className="option size-option"
                  aria-pressed={size === value}
                  disabled={
                    Boolean(color) &&
                    !selectedVariant(product.variants, color, value)
                  }
                  onClick={() => setSize(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {!sizes.length && (
              <p className="muted small">
                Sin talles publicados por el momento.
              </p>
            )}
          </fieldset>
          <div className="availability" role="status">
            <span className="status-dot" aria-hidden="true" />
            <p>
              {!product.variants.length
                ? "Sin variantes publicadas por el momento."
                : variant
                  ? `${variant.color} / ${variant.size}: variante publicada. Stock por confirmar.`
                  : "Elegí talle y color para consultar la combinación publicada."}
            </p>
          </div>
          <p className="muted small">
            La publicación de una variante no confirma unidades disponibles.
            Esta tienda ficticia todavía no acepta compras.
          </p>
          <AddToCart product={product} color={color} size={size} />
          <div className="detail-facts">
            <p>
              <span>01</span> Siluetas para todos los días.
            </p>
            <p>
              <span>02</span> Diseñado para lo esencial.
            </p>
            <p>
              <span>03</span> Envíos y retiro: próximamente.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
export function ProductPage({
  slug,
  service,
}: {
  slug: string;
  service: CatalogService;
}) {
  const [retry, setRetry] = useState(0);
  const load = useCallback(
    (signal: AbortSignal) => service.product(slug, signal),
    [service, slug],
  );
  const state = useAsync(load, retry);
  return (
    <section className="section-shell product-page">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && (
        <Feedback
          title="No pudimos abrir esta pieza"
          message={state.message}
          retry={() => setRetry((n) => n + 1)}
        />
      )}
      {state.status === "success" &&
        (state.data ? (
          <ProductDetail
            key={state.data.id}
            product={state.data}
            service={service}
          />
        ) : (
          <Feedback
            title="Esta pieza no está disponible"
            message="El producto no existe o ya no forma parte de la colección publicada."
          />
        ))}
    </section>
  );
}
