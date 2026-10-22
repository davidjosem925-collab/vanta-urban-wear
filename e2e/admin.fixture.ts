import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { expect, type Page } from "@playwright/test";
export const id = "10000000-0000-0000-0000-000000000001",
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
export async function fixture(
  page: Page,
  {
    member = true,
    emailMode = false,
    aal = "aal2",
    logged = true,
    empty = false,
    withPhoto = false,
    withDevice = false,
    totpDevices = [{ id: "factor", friendly_name: "fixture" }],
  }: {
    member?: boolean;
    emailMode?: boolean;
    aal?: string;
    logged?: boolean;
    empty?: boolean;
    withPhoto?: boolean;
    withDevice?: boolean;
    totpDevices?: { id: string; friendly_name: string }[];
  } = {},
) {
  const errors: string[] = [],
    writes: string[] = [],
    adjustKeys: string[] = [],
    uploads: string[] = [];
  const failures = {
    afterProductSave: "",
    afterVariantSave: "",
    afterImageSave: "",
    loseStockResponse: false,
    loseProductResponse: false,
  };
  const failedReads = new Map<string, number>();
  page.on("pageerror", (e) => errors.push(e.message));
  const user = {
    id,
    email: "admin@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-20T00:00:00Z",
    factors: totpDevices.map((f) => ({
      ...f,
      factor_type: "totp",
      status: "verified",
    })),
  };
  if (withDevice)
    user.factors.push({
      id: "device-factor",
      factor_type: "webauthn",
      status: "verified",
      friendly_name: "Mi dispositivo",
    });
  let passkeys: { id: string; friendly_name: string; created_at: string }[] =
    [];
  let credentialId = "";
  const challenge = Buffer.from(
    "local-test-challenge-not-a-remote-token",
  ).toString("base64url");
  function creation() {
    return {
      challenge,
      rp: { id: "localhost", name: "VANTA local test" },
      user: {
        id: Buffer.from(id).toString("base64url"),
        name: "local-fixture",
        displayName: "Local test",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 10000,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
      attestation: "none",
    };
  }
  function requestOptions() {
    return {
      challenge,
      rpId: "localhost",
      userVerification: "required",
      timeout: 10000,
      ...(credentialId
        ? { allowCredentials: [{ type: "public-key", id: credentialId }] }
        : {}),
    };
  }
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
      ({ s, emailMode }) =>
        (emailMode ? localStorage : sessionStorage).setItem(
          emailMode ? "vanta.admin.email.auth.v1" : "vanta.admin.auth.v1",
          JSON.stringify(s),
        ),
      { s: session(), emailMode },
    );
  let imageRows: {
    id: string;
    product_id: string;
    storage_path: string;
    alt: string;
    position: number;
  }[] = withPhoto
    ? [
        {
          id: "photo",
          product_id: id,
          storage_path: "vanta-demo-v1/remera-essential/front.png",
          alt: "Remera Essential, vista frontal",
          position: 0,
        },
      ]
    : [];
  let current = { ...product },
    exists = !empty,
    version = 0;
  const stocks = [{ variant_id: variant, on_hand: 6, reserved: 1 }];
  const movements: {
    id: string;
    variant_id: string;
    kind: string;
    quantity: number;
    reason: string;
    created_at: string;
    idempotency_key: string;
  }[] = [];
  const v = {
    id: variant,
    product_id: id,
    sku: "ESS-M-N",
    size: "M",
    color: "Negro",
    active: true,
  };
  let variants = empty ? [] : [v];
  let currentAal = aal;
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
      const table = path.split("/").at(-1)!;
      if (req.method() === "GET" && (failedReads.get(table) ?? 0) > 0) {
        failedReads.set(table, failedReads.get(table)! - 1);
        // A rejected read, without the SDK's automatic transient GET retries.
        return json({ message: "fixture read failed" }, 400);
      }
      if (path === "/auth/v1/passkeys/registration/options")
        return json({ challenge_id: "registration", options: creation() });
      if (path === "/auth/v1/passkeys/registration/verify") {
        credentialId = req.postDataJSON().credential.id;
        const d = {
          id: "passkey",
          friendly_name: "Dispositivo local",
          created_at: new Date().toISOString(),
        };
        passkeys.push(d);
        return json(d);
      }
      if (path === "/auth/v1/passkeys/authentication/options")
        return json({
          challenge_id: "authentication",
          options: requestOptions(),
        });
      if (path === "/auth/v1/passkeys/authentication/verify") {
        currentAal = "aal1";
        return json(session("aal1"));
      }
      if (path === "/auth/v1/passkeys") return json(passkeys);
      if (path === "/auth/v1/passkeys/passkey" && req.method() === "DELETE") {
        passkeys = [];
        return route.fulfill({ status: 204 });
      }
      if (path === "/auth/v1/factors" && req.method() === "POST") {
        const f = {
          id: "device-factor",
          factor_type: "webauthn",
          status: "unverified",
          friendly_name: "Mi dispositivo",
        };
        user.factors.push(f);
        return json({ ...f, type: "webauthn" });
      }
      if (path === "/auth/v1/factors/device-factor/challenge") {
        const creating =
          user.factors.find((f) => f.id === "device-factor")?.status !==
          "verified";
        return json({
          id: "device-challenge",
          type: "webauthn",
          webauthn: {
            type: creating ? "create" : "request",
            credential_options: {
              publicKey: creating ? creation() : requestOptions(),
            },
          },
        });
      }
      if (path === "/auth/v1/factors/device-factor/verify") {
        const b = req.postDataJSON();
        if (b.webauthn.type === "create")
          credentialId = b.webauthn.credential_response.id;
        user.factors.find((f) => f.id === "device-factor")!.status = "verified";
        currentAal = "aal2";
        return json(session("aal2"));
      }
      if (
        path === "/auth/v1/factors/device-factor" &&
        req.method() === "DELETE"
      ) {
        user.factors = user.factors.filter((f) => f.id !== "device-factor");
        return json({ id: "device-factor" });
      }
      if (path === "/auth/v1/user") return json(user);
      if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
      if (path === "/auth/v1/token")
        return json(
          session(
            url.searchParams.get("grant_type") === "password"
              ? "aal1"
              : currentAal,
          ),
        );
      if (path === "/auth/v1/recover") return json({});
      if (path === "/auth/v1/factors/factor/challenge")
        return json({
          id: "challenge",
          type: "totp",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        });
      if (path === "/auth/v1/factors/factor/verify") {
        currentAal = "aal2";
        return json(session("aal2"));
      }
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
          body: readFileSync(
            "supabase/seeds/optimized/vanta-demo-v1/remera-essential/front.png.vanta-card-v1.webp",
          ),
          contentType: "image/webp",
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
        if (name === "admin_access_mode")
          return json(emailMode ? "email" : "mfa");
        if (name === "admin_membership") return json(member);
        if (name === "is_admin")
          return json(member && (emailMode || currentAal === "aal2"));
        writes.push(name!);
        if (name === "admin_save_product") {
          if (!b.p_id && exists && b.p_values.slug === current.slug)
            return json({ code: "23505", message: "duplicate" }, 409);
          if (b.p_id && b.p_expected !== current.updated_at)
            return json({ code: "P0001", message: "EDIT_CONFLICT" }, 400);
          version++;
          exists = true;
          current = {
            ...current,
            ...b.p_values,
            updated_at: new Date(
              Date.UTC(2026, 9, 20, 0, version),
            ).toISOString(),
          };
          if (failures.afterProductSave) {
            failedReads.set(failures.afterProductSave, 1);
            failures.afterProductSave = "";
          }
          if (failures.loseProductResponse) {
            failures.loseProductResponse = false;
            return route.abort();
          }
          return json(current);
        }
        if (name === "admin_save_variant") {
          if (
            variants.some(
              (x) =>
                (x.sku === b.p_values.sku ||
                  (x.size === b.p_values.size &&
                    x.color === b.p_values.color)) &&
                x.id !== b.p_id,
            )
          )
            return json({ code: "23505", message: "duplicate" }, 409);
          const row = {
            ...v,
            id:
              b.p_id ??
              `10000000-0000-0000-0000-${String(100 + variants.length).padStart(12, "0")}`,
            ...b.p_values,
          };
          if (b.p_id) {
            const old = variants.find((v) => v.id === b.p_id);
            if (!isDeepStrictEqual(b.p_expected, old))
              return json({ code: "P0001", message: "EDIT_CONFLICT" }, 400);
            variants = variants.map((v) => (v.id === b.p_id ? row : v));
          } else {
            variants.push(row);
            stocks.push({ variant_id: row.id, on_hand: 0, reserved: 0 });
          }
          if (failures.afterVariantSave) {
            failedReads.set(failures.afterVariantSave, 1);
            failures.afterVariantSave = "";
          }
          return json(row);
        }
        if (name === "demo_admin_adjust_inventory") {
          adjustKeys.push(b.p_key);
          const old = movements.find((m) => m.idempotency_key === b.p_key);
          if (old) {
            expect([old.variant_id, old.quantity, old.reason]).toEqual([
              b.p_variant,
              b.p_delta,
              b.p_reason,
            ]);
            return json(false);
          }
          const stock = stocks.find((i) => i.variant_id === b.p_variant);
          if (!stock || stock.on_hand + b.p_delta < stock.reserved)
            return json(
              { code: "P0001", message: "INVALID_STOCK_ADJUSTMENT" },
              400,
            );
          stock.on_hand += b.p_delta;
          movements.unshift({
            id: b.p_key,
            variant_id: b.p_variant,
            kind: "adjust",
            quantity: b.p_delta,
            reason: b.p_reason,
            created_at: "2026-10-20T01:00:00Z",
            idempotency_key: b.p_key,
          });
          if (failures.loseStockResponse) {
            failures.loseStockResponse = false;
            return route.abort();
          }
          return json(true);
        }
        if (name === "admin_save_images") {
          if (!isDeepStrictEqual(b.p_expected, imageRows))
            return json({ code: "P0001", message: "EDIT_CONFLICT" }, 400);
          imageRows = b.p_rows.map(
            (r: Record<string, unknown>, position: number) => ({
              ...r,
              id: `img-${position}`,
              product_id: id,
              position,
            }),
          );
          if (failures.afterImageSave) {
            failedReads.set(failures.afterImageSave, 1);
            failures.afterImageSave = "";
          }
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
        if (!exists) return json([]);
        const slug = url.searchParams.get("slug"),
          active = url.searchParams.get("active"),
          name = url.searchParams.get("name");
        if (
          (slug && slug !== `eq.${current.slug}`) ||
          (active && active !== `eq.${current.active}`) ||
          (name &&
            !current.name
              .toLowerCase()
              .includes(name.replace(/^ilike\.%|%$/g, "").toLowerCase()))
        )
          return json([]);
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
      if (path === "/rest/v1/product_variants") return json(variants);
      if (path === "/rest/v1/product_images") return json(imageRows);
      if (path === "/rest/v1/inventory")
        return json(empty && !variants.length ? [] : stocks);
      if (path === "/rest/v1/inventory_movements") {
        const key = url.searchParams.get("idempotency_key");
        return json(
          key
            ? movements.filter((m) => `eq.${m.idempotency_key}` === key)
            : movements,
        );
      }
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
  return {
    errors,
    writes,
    adjustKeys,
    uploads,
    session,
    failures,
    getProduct: () => current,
    getVariants: () => variants,
    getImages: () => imageRows,
    getStock: () => stocks,
    getMovements: () => movements,
  };
}
export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
