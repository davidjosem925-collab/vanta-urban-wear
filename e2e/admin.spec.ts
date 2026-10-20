import { test, expect, type Page } from "@playwright/test";
const id = "10000000-0000-0000-0000-000000000001",
  variant = "10000000-0000-0000-0000-000000000002";
const product = {
  id,
  category_id: id,
  name: "Essential",
  slug: "essential",
  description: "Demo",
  price_cents: 2700050,
  currency: "ARS",
  active: true,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};
async function fixture(
  page: Page,
  {
    member = true,
    aal = "aal2",
    logged = true,
  }: { member?: boolean; aal?: string; logged?: boolean } = {},
) {
  const errors: string[] = [],
    writes: string[] = [],
    adjustKeys: string[] = [],
    uploads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = {
    id,
    email: "admin@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-20T00:00:00Z",
    factors: [
      {
        id: "factor",
        factor_type: "totp",
        status: "verified",
        friendly_name: "fixture",
      },
    ],
  };
  function session(level = aal) {
    const payload = {
      sub: id,
      role: "authenticated",
      aal: level,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return {
      access_token: `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture`,
      refresh_token: "fixture-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: payload.exp,
      user,
    };
  }
  if (logged)
    await page.addInitScript(
      (s) => sessionStorage.setItem("vanta.admin.auth.v1", JSON.stringify(s)),
      session(),
    );
  let imageRows: {
    id: string;
    product_id: string;
    storage_path: string;
    alt: string;
    position: number;
  }[] = [];
  let current = { ...product },
    stock = { variant_id: variant, on_hand: 6, reserved: 1 },
    adjusted = false;
  const v = {
    id: variant,
    product_id: id,
    sku: "ESS-M-N",
    size: "M",
    color: "Negro",
    active: true,
  };
  const order = {
    id,
    public_reference: variant,
    status: "pending",
    created_at: "2026-10-20T00:00:00Z",
    reservation_expires_at: "2026-10-20T01:00:00Z",
    reservation_resolved_at: null,
    subtotal_cents: 2700050,
    delivery: "pickup",
    demo_payment: "cash",
  };
  await page.route(
    "https://vanta-cart-fixture.supabase.co/**",
    async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      const json = (data: unknown, status = 200) =>
        route.fulfill({ json: data, status });
      if (path === "/auth/v1/user") return json(user);
      if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
      if (path === "/auth/v1/token")
        return json(
          session(
            url.searchParams.get("grant_type") === "pkce" ? "aal2" : "aal1",
          ),
        );
      if (path === "/auth/v1/recover") return json({});
      if (path === "/auth/v1/factors/factor/challenge")
        return json({
          id: "challenge",
          type: "totp",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        });
      if (path === "/auth/v1/factors/factor/verify")
        return json(session("aal2"));
      if (path.startsWith("/storage/v1/object/sign/product-images")) {
        if (req.method() === "POST") {
          const b = req.postDataJSON();
          return json(
            b.paths.map((p: string) => ({
              path: p,
              signedURL: `/object/sign/product-images/${p}?token=fixture`,
            })),
          );
        }
        return route.fulfill({
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
            "base64",
          ),
          contentType: "image/png",
        });
      }
      if (
        path.startsWith("/storage/v1/object/product-images/") &&
        req.method() === "POST"
      ) {
        uploads.push(path);
        return json({ Key: path, Id: id });
      }
      if (path.startsWith("/rest/v1/rpc/")) {
        const name = path.split("/").at(-1),
          b = req.postDataJSON() ?? {};
        if (name === "admin_membership") return json(member);
        if (name === "is_admin") return json(member);
        writes.push(name!);
        if (name === "admin_save_product") {
          current = {
            ...current,
            ...b.p_values,
            updated_at: "2026-10-20T00:01:00Z",
          };
          return json(current);
        }
        if (name === "admin_save_variant") return json({ ...v, ...b.p_values });
        if (name === "demo_admin_adjust_inventory") {
          adjustKeys.push(b.p_key);
          if (!adjusted) {
            stock = { ...stock, on_hand: stock.on_hand + b.p_delta };
            adjusted = true;
          }
          return json(true);
        }
        if (name === "admin_save_images") {
          imageRows = b.p_rows.map(
            (r: Record<string, unknown>, position: number) => ({
              ...r,
              id: `img-${position}`,
              product_id: id,
              position,
            }),
          );
          return json(null);
        }
        return json({ message: "unexpected" }, 500);
      }
      if (req.method() !== "GET") {
        writes.push(path);
        return json({ message: "unexpected write" }, 500);
      }
      if (path === "/rest/v1/products") {
        if (page.url().includes("#/catalogo"))
          expect(req.headers()["authorization"] ?? "").not.toContain(
            ".fixture",
          );
        return json([current]);
      }
      if (path === "/rest/v1/categories")
        return json([
          {
            id,
            name: "Remeras",
            slug: "remeras",
            active: true,
            created_at: "2026-10-20T00:00:00Z",
          },
        ]);
      if (path === "/rest/v1/product_variants") return json([v]);
      if (path === "/rest/v1/product_images") return json(imageRows);
      if (path === "/rest/v1/inventory") return json([stock]);
      if (path === "/rest/v1/inventory_movements") return json([]);
      if (path === "/rest/v1/orders") {
        expect(url.searchParams.get("is_demo")).toBe("eq.true");
        return json([order]);
      }
      if (path === "/rest/v1/order_items")
        return json([
          {
            id,
            product_name: "Snapshot Essential",
            sku: v.sku,
            size: v.size,
            color: v.color,
            quantity: 1,
            unit_price_cents: 2700050,
            line_total_cents: 2700050,
          },
        ]);
      if (path === "/rest/v1/stock_reservations")
        return json([
          {
            id,
            variant_id: variant,
            quantity: 1,
            status: "active",
            expires_at: order.reservation_expires_at,
          },
        ]);
      return json({ message: "unexpected route" }, 500);
    },
  );
  await page.goto("/#/admin");
  return { errors, writes, adjustKeys, uploads };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("admin: login, MFA step-up, logout and denial without data access", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1", logged: false });
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("Local-Fixture-Only-123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verificación en dos pasos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar con MFA" }).click();
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar MFA" }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Ver tienda", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "La colección." }),
  ).toBeVisible();
  await page.goto("/#/admin");
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await expect(page.getByText("Essential", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin: common user cannot enter or invoke management through the UI", async ({
  page,
}) => {
  const state = await fixture(page, { member: false });
  await expect(
    page.getByRole("heading", { name: "Acceso no autorizado" }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin: edits centavos, variants and confirms stock without changing reserved units", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Editar Essential" }).click();
  await expect(
    page.getByRole("heading", { name: "Editar producto" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Editar producto" }),
  ).toBeFocused();
  await page.getByLabel("Precio ARS · sin miles").fill("28000,50");
  await page
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(page.getByText("Información guardada.")).toBeVisible();
  await page.getByLabel("SKU", { exact: true }).last().fill("ESS-L-G");
  await page.getByLabel("Talle", { exact: true }).last().fill("L");
  await page.getByLabel("Color", { exact: true }).last().fill("Gris");
  await page.getByRole("button", { name: "Crear variante" }).click();
  await expect(page.getByText("Variante guardada.")).toBeVisible();
  await page.getByLabel("Ajuste de unidades").fill("2");
  await page.getByLabel("Motivo (sin datos personales)").fill("Recuento local");
  await page.getByRole("button", { name: "Revisar ajuste" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revisar ajuste" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Revisar ajuste" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Físico: 8 · Reservado: 1 · Disponible: 7"),
  ).toBeVisible();
  expect(state.adjustKeys).toHaveLength(1);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("admin-product.png"),
    fullPage: true,
  });
});
test("admin: demo orders are read-only, private fields never requested and snapshots preserved", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Pedidos demo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pedidos de demostración" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle" }).click();
  await expect(page.getByText("Snapshot Essential")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Confirmar pedido|Pagar|Cancelar pedido/,
    }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("admin-order.png"),
    fullPage: true,
  });
});

test("admin: uploads original plus WebP, previews privately, edits alt and unlinks without deleting storage", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Editar Essential" }).click();
  await page.getByLabel("Archivo (hasta 5 MiB)").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByLabel("Descripción de la imagen").fill("Foto de prueba");
  await page
    .getByRole("button", { name: "Preparar y cargar fotografía" })
    .click();
  await expect(
    page.getByText("Galería guardada. Los originales se conservan."),
  ).toBeVisible();
  expect(state.uploads).toHaveLength(4);
  await expect(page.getByRole("img", { name: "Foto de prueba" })).toBeVisible();
  await page.getByLabel("Texto alternativo").fill("Foto revisada");
  await page.getByRole("button", { name: "Guardar texto" }).click();
  await expect(page.getByRole("img", { name: "Foto revisada" })).toBeVisible();
  await page.getByRole("button", { name: "Retirar foto" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(page.getByText("Todavía no hay fotografías.")).toBeVisible();
  expect(state.uploads).toHaveLength(4);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});

test("admin: email recovery exchanges PKCE once and updates password only after authorized MFA session", async ({
  page,
}) => {
  const state = await fixture(page);
  let exchanges = 0;
  await page.route("**/auth/v1/token?grant_type=pkce", async (route) => {
    exchanges++;
    const b = route.request().postDataJSON();
    expect(b.auth_code).toBe("fixture-code");
    expect(b.code_verifier).toBe("fixture-verifier");
    return route.fallback();
  });
  await page.evaluate(() => {
    localStorage.setItem(
      "vanta.admin.auth.v1-flow-fixtureflow-code-verifier",
      JSON.stringify("fixture-verifier/recovery"),
    );
    // A second pending email flow must never replace this callback's verifier.
    localStorage.setItem(
      "vanta.admin.auth.v1-code-verifier",
      JSON.stringify("another-verifier/recovery"),
    );
  });
  await page.goto(
    "/?code=fixture-code&admin_recovery=1&sb_flow_id=fixtureflow#/admin",
  );
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toBeVisible();
  expect(exchanges).toBe(1);
  expect(page.url()).not.toContain("fixture-code");
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("New-Fixture-Password-123!");
  await page.getByLabel("Repetir contraseña").fill("New-Fixture-Password-123!");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Contraseña actualizada.")).toBeVisible();
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin: uncertain stock adjustment keeps its identity through reload and retries once", async ({
  page,
}) => {
  const state = await fixture(page);
  const keys: string[] = [];
  await page.route(
    "**/rest/v1/rpc/demo_admin_adjust_inventory",
    async (route) => {
      keys.push(route.request().postDataJSON().p_key);
      if (keys.length === 1) return route.abort();
      return route.fallback();
    },
  );
  await page.getByRole("button", { name: "Editar Essential" }).click();
  await page.getByLabel("Ajuste de unidades").fill("2");
  await page.getByLabel("Motivo (sin datos personales)").fill("Recuento local");
  await page.getByRole("button", { name: "Revisar ajuste" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText(/Hay un ajuste sin resultado confirmado/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Hay un ajuste sin resultado confirmado/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Consultar o reintentar el mismo ajuste" })
    .click();
  await expect(page.getByText(/Ajuste confirmado/)).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await page.getByRole("button", { name: "Editar Essential" }).click();
  await expect(
    page.getByText("Físico: 8 · Reservado: 1 · Disponible: 7"),
  ).toBeVisible();
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
