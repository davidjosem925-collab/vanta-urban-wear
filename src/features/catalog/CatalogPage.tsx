import { ArrowIcon } from "../../components/ArrowIcon";
import { useCallback, useState } from "react";
import { Photo } from "../../components/Photo";
import { Feedback, Loading } from "../../components/Feedback";
import { categoryHref, formatARS, menuCategories, productHref } from "./model";
import type { CatalogService } from "./service";
import { useAsync } from "./useAsync";

export function CatalogPage({
  service,
  categorySlug,
  home = false,
}: {
  service: CatalogService;
  categorySlug?: string;
  home?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const title = categorySlug
    ? (menuCategories.find((c) => c.slug === categorySlug)?.name ?? "Categoría")
    : home
      ? "La selección VANTA"
      : "Toda la colección";
  const load = useCallback(
    async (signal: AbortSignal) => {
      const categories = await service.categories(signal);
      const category = categorySlug
        ? categories.find((c) => c.slug === categorySlug)
        : undefined;
      if (categorySlug && !category)
        return { categoryMissing: true, products: [], hasMore: false };
      return {
        categoryMissing: false,
        ...(await service.products(category?.id, page, signal)),
      };
    },
    [service, categorySlug, page],
  );
  const state = useAsync(load, retry);
  const Heading = home ? "h2" : "h1";
  return (
    <section
      className="catalog-section section-shell"
      aria-labelledby="catalog-title"
    >
      {!home && (
        <nav className="breadcrumb" aria-label="Ruta de navegación">
          <a href="#/">Inicio</a>
          <span aria-hidden="true">/</span>
          {categorySlug ? (
            <>
              <a href="#/catalogo">Colección</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{title}</span>
            </>
          ) : (
            <span aria-current="page">Colección</span>
          )}
        </nav>
      )}
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {home ? "PIEZAS ESENCIALES" : "VANTA / COLECCIÓN"}
          </p>
          <Heading
            id="catalog-title"
            className={home ? "section-title" : "page-title"}
          >
            {title}
            <span className="heading-dot">.</span>
          </Heading>
        </div>
        {home && (
          <a className="text-link" href="#/catalogo">
            Ver colección completa <ArrowIcon />
          </a>
        )}
      </div>
      {!home && (
        <nav className="category-tabs" aria-label="Filtrar por categoría">
          <a
            href="#/catalogo"
            aria-current={!categorySlug ? "page" : undefined}
          >
            Todo
          </a>
          {menuCategories.map((c) => (
            <a
              key={c.slug}
              href={categoryHref(c.slug)}
              aria-current={categorySlug === c.slug ? "page" : undefined}
            >
              {c.name}
            </a>
          ))}
        </nav>
      )}
      {state.status === "loading" && <Loading />}
      {state.status === "error" && (
        <Feedback
          title="La colección no está disponible"
          message={state.message}
          retry={() => setRetry((n) => n + 1)}
        />
      )}
      {state.status === "success" && (
        <>
          {!state.data.products.length ? (
            <Feedback
              title={
                state.data.categoryMissing
                  ? "Esta categoría está en preparación"
                  : "Lo próximo está por llegar"
              }
              message="Todavía no hay piezas publicadas en esta selección. Volvé pronto para descubrir las novedades."
            />
          ) : (
            <>
              <div className="product-grid">
                {state.data.products.map((product) => (
                  <article className="product-card" key={product.id}>
                    <a
                      className="product-photo"
                      href={productHref(product.slug)}
                      aria-label={`Ver ${product.name}`}
                    >
                      <Photo
                        profile="card"
                        key={product.images[0]?.id ?? product.id}
                        image={product.images[0]}
                        service={service}
                      />
                      <span className="photo-corner">
                        <ArrowIcon />
                      </span>
                    </a>
                    <div className="product-info">
                      <p className="eyebrow">VANTA / ESSENTIALS</p>
                      <h2>
                        <a href={productHref(product.slug)}>{product.name}</a>
                      </h2>
                      <div className="price-row">
                        <span>{formatARS(product.price_cents)}</span>
                        <small>ARS</small>
                      </div>
                      <p className="product-note">
                        {product.variants.length
                          ? "Variantes publicadas · Stock por confirmar"
                          : "Sin variantes publicadas"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              {!home && (
                <nav className="pagination" aria-label="Páginas de productos">
                  <button
                    className="button secondary"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ← Anterior
                  </button>
                  <span aria-live="polite">Página {page + 1}</span>
                  <button
                    className="button secondary"
                    disabled={!state.data.hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Siguiente →
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
