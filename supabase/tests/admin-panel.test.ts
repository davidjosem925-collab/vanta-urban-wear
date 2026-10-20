// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDemoDb } from "./demo-fixture";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const a = "10000000-0000-0000-0000-000000000001",
  b = "10000000-0000-0000-0000-000000000002";
const values = {
  category_id: a,
  name: "Admin Product",
  slug: "admin-product",
  description: "Demo",
  price_cents: 2700050,
  active: false,
};
async function role(user = a, aal = "aal2", name = "authenticated") {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.aal','${aal}',false);set role ${name};`,
  );
}
async function product(
  v: unknown = values,
  id: string | null = null,
  expected: string | null = null,
) {
  return (
    await db.query<{ r: Record<string, unknown> }>(
      "select public.admin_save_product($1,$2,$3::jsonb) r",
      [id, expected, JSON.stringify(v)],
    )
  ).rows[0].r;
}
async function variant(
  productId: string,
  v: unknown = { sku: "NEW-S", size: "S", color: "Negro", active: true },
  id: string | null = null,
  expected: unknown = null,
) {
  return (
    await db.query<{ r: Record<string, unknown> }>(
      "select public.admin_save_variant($1,$2,$3::jsonb,$4::jsonb) r",
      [
        id,
        productId,
        expected === null ? null : JSON.stringify(expected),
        JSON.stringify(v),
      ],
    )
  ).rows[0].r;
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(
    `create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610200001_demo_orders.sql", "utf8"),
  );
  await db.exec(
    `insert into auth.users(id) values('${a}'),('${b}');insert into public.admin_profiles(user_id,display_name) values('${a}','Local admin');insert into public.categories(id,name,slug,active) values('${a}','Remeras','remeras',true);`,
  );
  await db.exec(
    readFileSync("supabase/operations/stage-6-preflight.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202610200002_admin_panel.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/operations/stage-6-verify.sql", "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    `reset role;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;delete from public.product_images;delete from public.inventory;delete from public.product_variants;delete from public.products;delete from storage.objects;update public.admin_profiles set active=true;`,
  );
  await role();
});
it("membership is safe at aal1 but every administrative write/read requires active admin and aal2", async () => {
  for (const [user, aal, active] of [
    [a, "aal1", true],
    [b, "aal2", true],
    [a, "aal2", false],
  ] as const) {
    await db.exec("reset role");
    await db.query("update public.admin_profiles set active=$1", [active]);
    await role(user, aal);
    expect(
      (await db.query("select public.is_admin() allowed")).rows[0].allowed,
    ).toBe(false);
    await expect(product()).rejects.toThrow("FORBIDDEN");
  }
  await db.exec("reset role;update public.admin_profiles set active=true");
  await role(a, "aal1");
  expect(
    (await db.query("select public.admin_membership() allowed")).rows[0]
      .allowed,
  ).toBe(true);
  expect((await db.query("select * from public.admin_profiles")).rows).toEqual(
    [],
  );
  await role();
  expect(
    (await db.query("select public.is_admin() allowed")).rows[0].allowed,
  ).toBe(true);
  await expect(
    db.exec(`update public.admin_profiles set active=true`),
  ).rejects.toThrow(/permission denied/);
});
it("catalog RPC preserves centavos, rejects stale edits and direct writes even as admin", async () => {
  const p = await product();
  expect(p.price_cents).toBe(2700050);
  expect(p.active).toBe(false);
  await expect(
    db.exec(
      `insert into public.products(category_id,name,slug,price_cents) values('${a}','Bypass','bypass',1)`,
    ),
  ).rejects.toThrow(/permission denied/);
  const next = await product(
    { ...values, name: "Updated" },
    String(p.id),
    String(p.updated_at),
  );
  expect(next.name).toBe("Updated");
  await expect(
    product({ ...values, name: "Stale" }, String(p.id), String(p.updated_at)),
  ).rejects.toThrow("EDIT_CONFLICT");
  for (const v of [
    { ...values, price_cents: -1 },
    { ...values, price_cents: "27000" },
    { ...values, active: "true" },
    { ...values, admin: true },
    { ...values, description: null },
  ])
    await expect(product(v)).rejects.toThrow("INVALID_REQUEST");
});
it("variant and zero inventory are atomic, SKU/combinations unique and identity stable", async () => {
  const p = await product(),
    v = await variant(String(p.id));
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 0, reserved: 0 }]);
  await expect(variant(String(p.id))).rejects.toThrow(/unique|duplicate/);
  expect((await db.query("select * from public.inventory")).rows).toHaveLength(
    1,
  );
  const updated = await variant(
    String(p.id),
    { sku: "NEW-S", size: "S", color: "Negro", active: false },
    String(v.id),
    v,
  );
  expect(updated.id).toBe(v.id);
  expect(updated.active).toBe(false);
  await expect(
    variant(
      String(p.id),
      { sku: "NEW-S", size: "S", color: "Negro", active: true },
      String(v.id),
      v,
    ),
  ).rejects.toThrow("EDIT_CONFLICT");
});
it("gallery is private, ordered atomically, conflict-safe, validates storage and never deletes objects", async () => {
  const p = await product();
  await db.query(
    "insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)",
    ["product-images", "vanta-admin/a/front.png", "vanta-admin/b/front.png"],
  );
  const save = (expected: unknown, rs: unknown) =>
    db.query("select public.admin_save_images($1,$2::jsonb,$3::jsonb)", [
      p.id,
      expected === null ? null : JSON.stringify(expected),
      JSON.stringify(rs),
    ]);
  const rs = [
    { storage_path: "vanta-admin/a/front.png", alt: "Original A" },
    { storage_path: "vanta-admin/b/front.png", alt: "Original B" },
  ];
  await save([], rs);
  const old = (
    await db.query("select * from public.product_images order by position")
  ).rows;
  await save(old, [...rs].reverse());
  expect(
    (
      await db.query(
        "select alt,position from public.product_images order by position",
      )
    ).rows,
  ).toEqual([
    { alt: "Original B", position: 0 },
    { alt: "Original A", position: 1 },
  ]);
  await expect(save(old, [])).rejects.toThrow("EDIT_CONFLICT");
  const now = (
    await db.query("select * from public.product_images order by position")
  ).rows;
  await expect(
    save(now, [{ storage_path: "missing", alt: "No" }]),
  ).rejects.toThrow("INVALID_REQUEST");
  expect(
    (await db.query("select * from public.product_images")).rows,
  ).toHaveLength(2);
  await save(now, []);
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    2,
  );
  await expect(db.exec("delete from storage.objects")).resolves.toBeDefined();
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    2,
  );
  await expect(
    db.exec("update storage.objects set name='overwrite'"),
  ).resolves.toBeDefined();
  expect(
    (await db.query("select name from storage.objects order by name")).rows[0]
      .name,
  ).toBe("vanta-admin/a/front.png");
  await expect(
    db.exec(
      "insert into storage.objects(bucket_id,name) values('product-images','vanta-demo-v1/overwrite.png')",
    ),
  ).rejects.toThrow(/row-level security/);
});
it("guest creation/expiry still work after MFA hardening; adjust is idempotent and cannot invade reservations", async () => {
  const p = await product({ ...values, active: true }),
    v = await variant(String(p.id));
  await db.query("select public.demo_admin_adjust_inventory($1,5,$2,$3)", [
    v.id,
    "Initial count",
    randomUUID(),
  ]);
  await role("", "", "service_role");
  const payload = {
    items: [{ variant_id: v.id, quantity: 2, expected_price_cents: 2700050 }],
    delivery: "pickup",
    payment: "cash",
  };
  const receipt = (
    await db.query("select public.demo_create_order($1,$2,$3::jsonb) r", [
      randomUUID(),
      "a".repeat(64),
      JSON.stringify(payload),
    ])
  ).rows[0].r as { reference: string };
  expect(receipt.reference).toBeTruthy();
  await role();
  const key = randomUUID();
  await db.query("select public.demo_admin_adjust_inventory($1,-1,$2,$3)", [
    v.id,
    "Count correction",
    key,
  ]);
  await db.query("select public.demo_admin_adjust_inventory($1,-1,$2,$3)", [
    v.id,
    "Count correction",
    key,
  ]);
  await expect(
    db.query("select public.demo_admin_adjust_inventory($1,-3,$2,$3)", [
      v.id,
      "Below reserved",
      randomUUID(),
    ]),
  ).rejects.toThrow("INVALID_STOCK_ADJUSTMENT");
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 4, reserved: 2 }]);
  await db.exec(
    "reset role;update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders();",
  );
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 4, reserved: 0 }]);
  expect(
    (await db.query("select status from public.orders")).rows[0].status,
  ).toBe("expired");
});
it("public functions have no EXECUTE and plain users cannot upload or elevate membership", async () => {
  await role(b, "aal2");
  await expect(
    db.exec(
      "insert into storage.objects(bucket_id,name) values('product-images','vanta-admin/attack.png')",
    ),
  ).rejects.toThrow(/row-level security/);
  for (const name of [
    "admin_save_product(uuid,timestamptz,jsonb)",
    "admin_save_variant(uuid,uuid,jsonb,jsonb)",
    "admin_save_images(uuid,jsonb,jsonb)",
    "admin_membership()",
  ])
    expect(
      (
        await db.query("select has_function_privilege($1,$2,$3) ok", [
          "anon",
          "public." + name,
          "EXECUTE",
        ])
      ).rows[0].ok,
    ).toBe(false);
});
