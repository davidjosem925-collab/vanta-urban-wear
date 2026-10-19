import { ArrowIcon } from "../components/ArrowIcon";
import { useEffect, useState } from "react";
import { CatalogPage } from "../features/catalog/CatalogPage";
import { ProductPage } from "../features/catalog/ProductPage";
import { categoryHref, menuCategories } from "../features/catalog/model";
import {
  catalogService,
  type CatalogService,
} from "../features/catalog/service";
import { Feedback } from "../components/Feedback";
import { useRoute } from "./router";
import { CartProvider } from "../features/cart/CartProvider";
import { CartDrawer, CartTrigger } from "../features/cart/CartDrawer";

function Home({ service }: { service: CatalogService }) {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <img
          className="hero-photo"
          src="/images/vanta-editorial.webp"
          alt="Silueta urbana en negro y grafito junto a una pared de hormigón"
          fetchPriority="high"
        />
        <div className="hero-shade" />
        <div className="hero-content section-shell">
          <p className="eyebrow">BUENOS AIRES / URBAN ESSENTIALS</p>
          <h1 id="hero-title">
            Presencia
            <br />
            <em>sin esfuerzo.</em>
          </h1>
          <p className="hero-description">
            Siluetas urbanas. Tonos esenciales.
            <br />
            Menos ruido. Más identidad.
          </p>
          <a className="button primary" href="#/catalogo">
            Explorá la colección <ArrowIcon />
          </a>
        </div>
        <div className="hero-bottom section-shell">
          <span>VANTA — THE ESSENTIAL FORM</span>
          <span>01 / SIN TEMPORADA</span>
        </div>
      </section>
      <div className="brand-strip">
        <span>SILUETAS AMPLIAS</span>
        <span className="strip-mark" aria-hidden="true">
          +
        </span>
        <span>IDENTIDAD PROPIA</span>
        <span className="strip-mark" aria-hidden="true">
          +
        </span>
        <span>ESENCIA URBANA</span>
        <span className="strip-mark" aria-hidden="true">
          +
        </span>
        <span>VANTA / BUENOS AIRES</span>
      </div>
      <section
        className="category-section section-shell"
        aria-labelledby="category-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">ENCONTRÁ TU FORMA</p>
            <h2 id="category-title" className="section-title">
              El universo VANTA<span className="heading-dot">.</span>
            </h2>
          </div>
          <p className="section-aside">Cuatro formas de ser vos.</p>
        </div>
        <div className="category-grid">
          {menuCategories.map((c, index) => (
            <a
              className="category-card"
              href={categoryHref(c.slug)}
              key={c.slug}
            >
              <img
                className="category-photo"
                src={c.image}
                style={{ left: `${-index * 100}%` }}
                alt=""
                loading="lazy"
                decoding="async"
                width={1536}
                height={1024}
              />
              <div className="category-copy">
                <h3>{c.name}</h3>
                <p>{c.caption}</p>
              </div>
              <span className="category-arrow">
                <ArrowIcon />
              </span>
            </a>
          ))}
        </div>
      </section>
      <CatalogPage service={service} home />
      <section className="manifesto section-shell">
        <p className="eyebrow">NUESTRA ESENCIA</p>
        <h2>
          No seguimos el ritmo.
          <br />
          <em>Lo hacemos propio.</em>
        </h2>
        <p>
          La ciudad cambia. Tu identidad permanece.
          <br />
          Prendas esenciales para una forma de vivir sin etiquetas.
        </p>
        <span className="manifesto-mark" aria-hidden="true">
          V.
        </span>
      </section>
    </>
  );
}
export function App({
  service = catalogService,
}: {
  service?: CatalogService;
}) {
  return (
    <CartProvider service={service}>
      <AppShell service={service} />
    </CartProvider>
  );
}
function AppShell({ service }: { service: CatalogService }) {
  const { route, routeKey } = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const pageTitle =
    route.kind === "product"
      ? "Producto"
      : route.kind === "category"
        ? (menuCategories.find((c) => c.slug === route.slug)?.name ??
          "Colección")
        : route.kind === "catalog"
          ? "Colección"
          : "Urban Wear";
  useEffect(() => {
    document.title = `VANTA — ${pageTitle}`;
  }, [pageTitle]);
  useEffect(() => {
    if (!menuOpen) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("menu-toggle")?.focus();
      }
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen]);
  return (
    <>
      <a
        className="skip-link"
        href="#contenido"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("contenido")?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <div className="announcement">
        PROYECTO FICTICIO / PORTFOLIO <span aria-hidden="true">—</span> COMPRAS
        PRÓXIMAMENTE
      </div>
      <header className="site-header">
        <div className="header-inner section-shell">
          <a
            className="logo"
            href="#/"
            aria-label="VANTA, inicio"
            onClick={() => setMenuOpen(false)}
          >
            VANTA<span>®</span>
          </a>
          <button
            id="menu-toggle"
            className="menu-toggle"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "CERRAR -" : "MENÚ +"}
          </button>
          <nav
            id="main-navigation"
            className={`main-navigation ${menuOpen ? "is-open" : ""}`}
            aria-label="Navegación principal"
            onClick={() => setMenuOpen(false)}
          >
            <a
              href="#/"
              aria-current={route.kind === "home" ? "page" : undefined}
            >
              Inicio
            </a>
            <a
              href="#/catalogo"
              aria-current={route.kind === "catalog" ? "page" : undefined}
            >
              Colección
            </a>
            {menuCategories.map((c) => (
              <a
                href={categoryHref(c.slug)}
                key={c.slug}
                aria-current={
                  route.kind === "category" && route.slug === c.slug
                    ? "page"
                    : undefined
                }
              >
                {c.name}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <span className="header-caption">
              HECHO PARA LA CIUDAD <ArrowIcon />
            </span>
            <CartTrigger beforeOpen={() => setMenuOpen(false)} />
          </div>
        </div>
      </header>
      <main id="contenido" tabIndex={-1} key={routeKey}>
        {route.kind === "home" && <Home service={service} />}
        {route.kind === "catalog" && <CatalogPage service={service} />}
        {route.kind === "category" && (
          <CatalogPage service={service} categorySlug={route.slug} />
        )}
        {route.kind === "product" && (
          <ProductPage slug={route.slug} service={service} />
        )}
        {route.kind === "missing" && (
          <div className="section-shell">
            <Feedback
              title="Este camino no existe"
              message="Volvé a la colección y encontrá tu próxima pieza."
            />
          </div>
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-main section-shell">
          <div>
            <a className="logo footer-logo" href="#/">
              VANTA<span>®</span>
            </a>
            <p>Menos ruido. Más identidad.</p>
            <p className="muted small">
              Tienda ficticia de indumentaria urbana.
              <br />
              Proyecto de portfolio. No acepta compras.
            </p>
          </div>
          <div>
            <h2>Explorá</h2>
            <a href="#/catalogo">Toda la colección</a>
            {menuCategories.map((c) => (
              <a href={categoryHref(c.slug)} key={c.slug}>
                {c.name}
              </a>
            ))}
          </div>
          <div>
            <h2>Conectá</h2>
            <a
              href="https://www.instagram.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram <ArrowIcon />
            </a>
            <a
              href="https://www.whatsapp.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp <ArrowIcon />
            </a>
            <p className="muted small">
              Enlaces de referencia a las plataformas.
              <br />
              No son canales de contacto de VANTA.
            </p>
          </div>
          <div>
            <h2>Buenos Aires, AR</h2>
            <p className="muted small">
              Estudio VANTA · Dirección ficticia
              <br />
              Calle Imaginaria 000, Buenos Aires
              <br />
              hola@vanta.example
              <br />
              Datos ilustrativos, sin atención al público.
            </p>
          </div>
        </div>
        <div className="footer-bottom section-shell">
          <span>© {new Date().getFullYear()} VANTA — URBAN WEAR</span>
          <span>DISEÑADO PARA LO ESENCIAL.</span>
        </div>
      </footer>
      <CartDrawer />
    </>
  );
}
