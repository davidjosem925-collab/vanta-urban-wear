import {
  paymentService,
  type PaymentService,
} from "../features/payments/service";
import { usePayment } from "../features/payments/usePayment";
import { ArrowIcon } from "../components/ArrowIcon";
import { lazy, Suspense, useEffect, useState, useRef } from "react";
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
import { CartFeedback } from "../features/cart/CartFeedback";
import { useCart } from "../features/cart/context";
import { useDemoOrder } from "../features/orders/useDemoOrder";
import {
  orderService,
  type OrderService,
  type Receipt,
} from "../features/orders/service";
import { initialDraft } from "../features/checkout/model";
const PaymentPage = lazy(() =>
  import("../features/payments/PaymentPage").then((m) => ({
    default: m.PaymentPage,
  })),
);
const AdminPage = lazy(() =>
  import("../features/admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const CheckoutPage = lazy(() =>
  import("../features/checkout/CheckoutPage").then((module) => ({
    default: module.CheckoutPage,
  })),
);

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
  orders = orderService,
  payments = paymentService,
}: {
  service?: CatalogService;
  orders?: OrderService;
  payments?: PaymentService;
}) {
  return (
    <CartProvider service={service}>
      <AppShell service={service} orders={orders} payments={payments} />
    </CartProvider>
  );
}
function AppShell({
  service,
  orders,
  payments,
}: {
  service: CatalogService;
  orders: OrderService;
  payments: PaymentService;
}) {
  const cart = useCart();
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const paymentFlow = usePayment(payments);
  const [orderReceipt, setOrderReceipt] = useState<Receipt | null>(null);
  const orderFlow = useDemoOrder(orders, (result, submitted, attempt) => {
    const paymentEnabled =
      payments.enabled &&
      ["mercado_pago", "transfer"].includes(submitted.payment);
    if (paymentEnabled) paymentFlow.attach(result, attempt);
    const current = cartRef.current;
    // Preserve additions made during a slow request; remove only confirmed quantities.
    for (const item of submitted.items) {
      const line = current.entries.find(
        (e) => e.line.variantId === item.variant_id,
      )?.line;
      if (!line) continue;
      if (line.quantity <= item.quantity) current.remove(line.variantId);
      else current.setQuantity(line.variantId, line.quantity - item.quantity);
    }
    setOrderReceipt(result);
    setCheckoutCompleted(true);
    window.location.hash = paymentEnabled
      ? "/checkout/pago"
      : "/checkout/finalizado";
  });
  const { route, routeKey } = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  // Draft lives outside keyed route content, only in memory. No extra provider.
  const [checkoutDraft, setCheckoutDraft] = useState(() => ({
    ...initialDraft,
    payment: payments.enabled
      ? ("mercado_pago" as const)
      : initialDraft.payment,
  }));
  const [checkoutCompleted, setCheckoutCompleted] = useState(false);
  const checkoutStep = route.kind === "checkout" ? route.step : null;
  // Existing provider requests are immutable; old phase-2 return URLs must also recover safely.
  useEffect(() => {
    if (
      payments.enabled &&
      paymentFlow.session &&
      (checkoutStep === "review" || checkoutStep === "complete")
    )
      window.location.hash = "/checkout/pago";
  }, [payments.enabled, paymentFlow.session, checkoutStep]);
  useEffect(() => {
    if (checkoutStep && checkoutStep !== "complete") {
      setCheckoutCompleted(false);
      setOrderReceipt(null);
    }
  }, [checkoutStep]);
  const pageTitle =
    route.kind === "admin"
      ? "Administración"
      : route.kind === "payment"
        ? "Pago"
        : route.kind === "checkout"
          ? "Finalizar compra"
          : route.kind === "product"
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
  if (route.kind === "admin")
    return (
      <>
        <div className="admin-topbar">
          <a href="#/">VANTA ®</a>
          <span>ADMINISTRACIÓN PRIVADA</span>
          <a href="#/catalogo">Ver tienda</a>
        </div>
        <main id="contenido" tabIndex={-1}>
          <Suspense
            fallback={
              <p className="section-shell" role="status">
                Preparando administración…
              </p>
            }
          >
            <AdminPage />
          </Suspense>
        </main>
      </>
    );
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
        PROYECTO FICTICIO / PORTFOLIO — NO SE REALIZAN COMPRAS REALES
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
      {payments.enabled && paymentFlow.session && route.kind !== "payment" && (
        <nav
          className="payment-access section-shell"
          aria-label="Pedido en curso"
        >
          <span>Tu pedido sigue disponible.</span>
          <a className="cart-text-button" href="#/checkout/pago">
            Consultar mi pago
          </a>
        </nav>
      )}
      <main id="contenido" tabIndex={-1} key={routeKey}>
        {route.kind === "home" && <Home service={service} />}
        {route.kind === "catalog" && <CatalogPage service={service} />}
        {route.kind === "category" && (
          <CatalogPage service={service} categorySlug={route.slug} />
        )}
        {route.kind === "product" && (
          <ProductPage slug={route.slug} service={service} />
        )}
        {route.kind === "payment" && (
          <Suspense
            fallback={
              <p className="section-shell" role="status">
                Preparando consulta de pago…
              </p>
            }
          >
            <PaymentPage
              flow={paymentFlow}
              notificationsEnabled={Boolean(orders.notificationsEnabled)}
            />
          </Suspense>
        )}
        {route.kind === "checkout" && (
          <Suspense
            fallback={
              <p className="section-shell" role="status">
                Preparando checkout…
              </p>
            }
          >
            <CheckoutPage
              paymentsEnabled={payments.enabled}
              paymentSession={
                Boolean(paymentFlow.session) || paymentFlow.blocked
              }
              orders={orders}
              orderFlow={orderFlow}
              orderReceipt={orderReceipt}
              step={route.step}
              draft={checkoutDraft}
              setDraft={setCheckoutDraft}
              completed={checkoutCompleted}
              onComplete={() => setCheckoutCompleted(true)}
            />
          </Suspense>
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
            <p className="muted small">Portfolio de diseño y desarrollo.</p>
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
              Estudio VANTA
              <br />
              Sin local ni atención al público.
            </p>
          </div>
        </div>
        <div className="footer-bottom section-shell">
          <span>© {new Date().getFullYear()} VANTA — URBAN WEAR</span>
          <span>DISEÑADO PARA LO ESENCIAL.</span>
        </div>
      </footer>
      <CartDrawer />
      <CartFeedback
        suspendFloating={route.kind === "checkout" || route.kind === "payment"}
      />
    </>
  );
}
