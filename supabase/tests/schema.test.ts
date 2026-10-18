// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const ids = {
  category: '00000000-0000-0000-0000-000000000001',
  product: '00000000-0000-0000-0000-000000000002',
  variant: '00000000-0000-0000-0000-000000000003',
  admin: '00000000-0000-0000-0000-000000000004',
  outsider: '00000000-0000-0000-0000-000000000005',
  order: '00000000-0000-0000-0000-000000000006',
}
async function asRole(role: 'anon' | 'authenticated', sql: string, user = ids.outsider) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user}', false)`)
  try { return await db.query(sql) } finally { await db.exec('reset role') }
}
beforeAll(async () => {
  // Minimal Supabase contracts, not a replacement for testing the real local stack.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `)
  for (const file of ['202610180001_initial_schema.sql','202610180002_storage.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  await db.exec(`
    insert into auth.users values ('${ids.admin}'), ('${ids.outsider}');
    insert into public.admin_profiles(user_id,display_name) values ('${ids.admin}','Admin');
    insert into public.categories(id,name,slug,active) values ('${ids.category}','Remeras','remeras',true);
    insert into public.products(id,category_id,name,slug,price_cents,active) values ('${ids.product}','${ids.category}','Essential','essential',2500000,true);
    insert into public.product_variants(id,product_id,sku,size,color,active) values ('${ids.variant}','${ids.product}','ESS-M-BLK','M','Negro',true);
    insert into public.inventory(variant_id,on_hand) values ('${ids.variant}',1);
    insert into public.product_images(product_id,storage_path,alt) values ('${ids.product}','essential.webp','Remera');
    insert into storage.objects(bucket_id,name) values ('product-images','essential.webp');
    insert into public.orders(id,idempotency_key,request_hash,first_name,last_name,email,phone,subtotal_cents)
      values ('${ids.order}',gen_random_uuid(),repeat('a',64),'Test','Buyer','test@example.com','12345678',2500000);
  `)
}, 30000)
afterAll(async () => { await db.close() })
describe('Migraciones y seguridad PostgreSQL', () => {
  it('permite catálogo activo y oculta productos desactivados', async () => {
    expect((await asRole('anon','select * from public.products')).rows).toHaveLength(1)
    await db.exec(`update public.products set active=false where id='${ids.product}'`)
    expect((await asRole('anon','select * from public.products')).rows).toHaveLength(0)
    expect((await asRole('anon','select * from public.product_variants')).rows).toHaveLength(0)
    expect((await asRole('anon','select * from storage.objects')).rows).toHaveLength(0)
    await db.exec(`update public.products set active=true where id='${ids.product}'`)
    expect((await asRole('anon','select * from storage.objects')).rows).toHaveLength(1)
  })
  it('deniega datos personales y cambios anónimos', async () => {
    for (const table of ['orders','order_items','payments','payment_events','shipments','stock_reservations','inventory','admin_profiles']) {
      await expect(asRole('anon',`select * from public.${table}`)).rejects.toThrow(/permission denied/)
    }
    await expect(asRole('anon','update public.products set price_cents=1')).rejects.toThrow(/permission denied/)
    await expect(asRole('anon','update public.inventory set on_hand=100')).rejects.toThrow(/permission denied/)
    await expect(asRole('anon',`insert into public.orders default values`)).rejects.toThrow(/permission denied/)
  })
  it('distingue administrador de usuario autenticado sin escalamiento', async () => {
    expect((await asRole('authenticated','select * from public.orders')).rows).toHaveLength(0)
    expect((await asRole('authenticated','select * from public.orders',ids.admin)).rows).toHaveLength(1)
    expect((await asRole('authenticated',`update public.products set price_cents=1 returning id`)).rows).toHaveLength(0)
    await expect(asRole('authenticated',`insert into public.admin_profiles(user_id,display_name) values ('${ids.outsider}','Intruso')`)).rejects.toThrow(/permission denied/)
    await expect(asRole('authenticated','update public.inventory set on_hand=9',ids.admin)).rejects.toThrow(/permission denied/)
  })
  it('impide stock negativo y reservas superiores al stock físico', async () => {
    await expect(db.exec('update public.inventory set on_hand=-1')).rejects.toThrow(/check constraint/)
    await expect(db.exec('update public.inventory set reserved=2')).rejects.toThrow(/check constraint/)
  })
  it('impide dos pagos aprobados y claves de idempotencia duplicadas', async () => {
    const key = '00000000-0000-0000-0000-000000000009'
    await db.exec(`insert into public.payments(order_id,method,status,idempotency_key,amount_cents) values ('${ids.order}','bank_transfer','approved','${key}',2500000)`)
    await expect(db.exec(`insert into public.payments(order_id,method,status,idempotency_key,amount_cents) values ('${ids.order}','cash_pickup','approved',gen_random_uuid(),2500000)`)).rejects.toThrow(/unique constraint/)
    await expect(db.exec(`insert into public.payments(order_id,method,idempotency_key,amount_cents) values ('${ids.order}','bank_transfer','${key}',2500000)`)).rejects.toThrow(/unique constraint/)
  })
  it('valida domicilio de envío y precio no negativo', async () => {
    await expect(db.exec(`insert into public.shipments(order_id,method) values ('${ids.order}','correo_argentino')`)).rejects.toThrow(/check constraint/)
    await expect(db.exec('update public.products set price_cents=-1')).rejects.toThrow(/check constraint/)
  })
})
