// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../scripts/demo-catalog.mjs';
import { buildDemoSql, buildDemoStatements } from '../../scripts/prepare-demo-catalog.mjs';

const source = JSON.parse(readFileSync('supabase/seeds/catalog.demo.json', 'utf8'));
const unconfirmedSeed = readFileSync('supabase/seeds/catalog.example.sql', 'utf8');
const seed = buildDemoSql(catalog(), source.project_ref);
let db: PGlite;
async function scalar(sql: string) {
  return (await db.query<{ n: number }>(sql)).rows[0].n;
}
async function publicQuery(sql: string, role = 'anon') {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}
beforeEach(async () => {
  db = new PGlite();
  // Same embedded Supabase contracts as the migration suite; no network or real Storage API.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  for (const file of ['202610180001_initial_schema.sql','202610180002_storage.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  for (const product of source.products) {
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', [source.bucket,product.image.storage_path]);
  }
}, 30000);
afterEach(async () => { await db.close(); });
describe('Catálogo demo VANTA: SQL real sobre migraciones vigentes', () => {
  it('reproduce 42P01 al confirmar la creación antigua ON COMMIT DROP antes de usarla', async () => {
    await db.exec('create temp table vanta_demo_categories(id uuid) on commit drop;');
    await expect(db.query('select * from vanta_demo_categories')).rejects.toMatchObject({code:'42P01'});
    // PostgreSQL itself does not drop it early when the complete transaction is retained.
    await db.exec('begin; create temp table regression_categories(id uuid) on commit drop; insert into regression_categories values (gen_random_uuid());');
    expect(await scalar('select count(*)::int n from regression_categories')).toBe(1);
    await db.exec('commit');
    await expect(db.query('select * from regression_categories')).rejects.toMatchObject({code:'42P01'});
  });
  it('ejecuta la carga como una sentencia autónoma y el resumen en otra petición sin estado de sesión', async () => {
    const [block,summary] = buildDemoStatements(catalog(), source.project_ref);
    expect(unconfirmedSeed).toBe(buildDemoSql(catalog()));
    expect(block).not.toMatch(/create\s+(?:temp|temporary)\s+table|on\s+commit\s+drop|current_setting|set_config/i);
    // query() accepts a single statement, unlike exec() accepting an entire script.
    await db.query(block);
    await db.exec('discard all');
    expect((await db.query(summary)).rows).toEqual([{
      demo_products:8, demo_variants:64, demo_images:8, demo_inventory_rows:64,
    }]);
    await db.query(block);
    expect(await scalar('select count(*)::int n from public.products')).toBe(8);
  });
  it('mantiene exactamente las ocho rutas del JSON y rechaza rutas antiguas en la raíz', async () => {
    const paths=source.products.map((p: {image:{storage_path:string}})=>p.image.storage_path).sort();
    expect(new Set(paths).size).toBe(8);
    for (const path of paths) expect(path).toMatch(/^vanta-demo-v1\/[^/]+\/front\.png$/);
    await db.exec("update storage.objects set name=replace(name,'/front.png','.png')");
    await expect(db.exec(seed)).rejects.toThrow(/Faltan fotografías/);
    await db.exec('rollback');
    expect(await scalar('select count(*)::int n from public.products')).toBe(0);
    await db.exec('delete from storage.objects');
    for(const path of paths) await db.query("insert into storage.objects(bucket_id,name) values ('product-images',$1)",[path]);
    await db.exec(seed);
    expect((await db.query<{storage_path:string}>('select storage_path from public.product_images order by storage_path')).rows.map(r=>r.storage_path)).toEqual(paths);
  });
  it('crea ocho productos, dos por categoría, 64 variantes e inventario sin duplicar al repetir', async () => {
    await db.exec(seed);
    const before = (await db.query('select id,slug,updated_at from public.products order by id')).rows;
    await db.exec(seed);
    expect((await db.query('select id,slug,updated_at from public.products order by id')).rows).toEqual(before);
    expect(await scalar('select count(*)::int n from public.products')).toBe(8);
    expect((await db.query('select count(*)::int n from public.products group by category_id')).rows.map(r => r.n)).toEqual([2,2,2,2]);
    expect(await scalar('select count(*)::int n from public.product_variants')).toBe(64);
    expect(await scalar('select count(*)::int n from public.product_images')).toBe(8);
    expect(await scalar('select count(*)::int n from public.inventory where on_hand=6 and reserved=0')).toBe(64);
    expect(await scalar('select sum(on_hand)::int n from public.inventory')).toBe(384);
    expect(await scalar('select count(*)::int n from public.products where currency=\'ARS\' and price_cents>0')).toBe(8);
    for (const table of ['orders','order_items','payments','stock_reservations']) expect(await scalar(`select count(*)::int n from public.${table}`)).toBe(0);
  });
  it('preserva categorías y productos ajenos, stock cambiado y reservas al repetir', async () => {
    await db.exec(`insert into public.categories(name,slug,active) values ('Remeras','remeras',true),('Ajena','otra',true);
      insert into public.products(category_id,name,slug,price_cents,active) select id,'Ajeno','otro-producto',123,true from public.categories where slug='otra';`);
    const category = (await db.query("select id from public.categories where slug='remeras'")).rows[0].id;
    await db.exec(seed);
    await db.exec(`update public.inventory set on_hand=4,reserved=1 where variant_id=(select variant_id from public.inventory limit 1)`);
    const inventory = (await db.query('select * from public.inventory order by variant_id')).rows;
    await db.exec(seed);
    expect((await db.query('select * from public.inventory order by variant_id')).rows).toEqual(inventory);
    expect((await db.query("select id from public.categories where slug='remeras'")).rows[0].id).toBe(category);
    expect(await scalar("select price_cents::int n from public.products where slug='otro-producto'")).toBe(123);
    expect(await scalar('select count(*)::int n from public.products')).toBe(9);
  });
  it('cancela toda la transacción si existe una colisión de slug ajena', async () => {
    await db.exec(`insert into public.categories(name,slug,active) values ('Ajena','otra',true)`);
    await db.query(`insert into public.products(category_id,name,slug,price_cents,active)
      select id,'No tocar',$1,123,true from public.categories where slug='otra'`, [source.products[0].slug]);
    await expect(db.exec(seed)).rejects.toThrow(/Colisión/);
    await db.exec('rollback');
    expect(await scalar('select count(*)::int n from public.categories')).toBe(1);
    expect(await scalar('select count(*)::int n from public.products')).toBe(1);
    expect(await scalar('select price_cents::int n from public.products')).toBe(123);
    expect(await scalar('select count(*)::int n from public.product_variants')).toBe(0);
  });
  it('rechaza falta de confirmación y fotografías faltantes antes de publicar', async () => {
    await expect(db.exec(unconfirmedSeed)).rejects.toThrow(/confirmar/);
    await db.exec('rollback');
    await db.exec('delete from storage.objects');
    await expect(db.exec(seed)).rejects.toThrow(/Faltan fotografías/);
    await db.exec('rollback');
    expect(await scalar('select count(*)::int n from public.products')).toBe(0);
  });
  it('respeta RLS: lectura pública de activos e imágenes, inventario privado y escrituras denegadas', async () => {
    await db.exec(seed);
    expect((await publicQuery('select * from public.products')).rows).toHaveLength(8);
    expect((await publicQuery('select * from public.product_variants')).rows).toHaveLength(64);
    expect((await publicQuery('select * from storage.objects')).rows).toHaveLength(8);
    await expect(publicQuery('select * from public.inventory')).rejects.toThrow(/permission denied/);
    await expect(publicQuery('update public.products set price_cents=1')).rejects.toThrow(/permission denied/);
    expect((await publicQuery('update public.products set price_cents=1 returning id','authenticated')).rows).toHaveLength(0);
    await expect(publicQuery('update public.inventory set on_hand=100','authenticated')).rejects.toThrow(/permission denied/);
    await db.exec(`update public.products set active=false where id=(select id from public.products limit 1)`);
    expect((await publicQuery('select * from public.products')).rows).toHaveLength(7);
    expect((await publicQuery('select * from public.product_variants')).rows).toHaveLength(56);
    expect((await publicQuery('select * from storage.objects')).rows).toHaveLength(7);
  });
});
