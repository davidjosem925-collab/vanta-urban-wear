// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog, extensionCatalog, selectCatalog, hash, PROJECT_REF } from '../../scripts/demo-catalog.mjs';
import { buildDemoSql, buildDemoStatements } from '../../scripts/prepare-demo-catalog.mjs';
import { createDemoDb } from './demo-fixture';
const base=catalog();
const extension=selectCatalog('extension');
const all=selectCatalog();
const baseSeed=buildDemoSql(base,PROJECT_REF);
const extensionSeed=buildDemoSql(extension,PROJECT_REF);
let db:PGlite;
async function count(table:string) { return (await db.query<{n:number}>(`select count(*)::int n from public.${table}`)).rows[0].n; }
async function baseSnapshot() {
  const ids=base.products.map(p=>`'${p.id}'`).join(',');
  const result:Record<string,unknown>={};
  for(const [table,where,key] of [
    ['products',`id in (${ids})`,'id'],
    ['product_variants',`product_id in (${ids})`,'id'],
    ['product_images',`product_id in (${ids})`,'id'],
    ['inventory',`variant_id in (select id from public.product_variants where product_id in (${ids}))`,'variant_id'],
    ['categories','true','id'],
    ['orders','true','id'],['payments','true','id'],['stock_reservations','true','id'],
  ]) result[table]=(await db.query(`select * from public.${table} where ${where} order by ${key}`)).rows;
  result.objects=(await db.query('select * from storage.objects order by id')).rows;
  return result;
}
beforeEach(async()=>{
  db=await createDemoDb();
  for(const product of all.products) {
    await db.query("insert into storage.objects(bucket_id,name) values ('product-images',$1)",[product.image.storage_path]);
  }
},30000);
afterEach(async()=>{await db.close();});
describe('Ampliación incremental de ocho a doce modelos VANTA',()=>{
  it('conserva la identidad exacta de los ocho originales y define los cuatro modelos pedidos',()=>{
    // Fingerprint captured from the version loaded before this extension, including
    // names, descriptions, prices, IDs, SKUs, image paths and original image hashes.
    expect(hash(JSON.stringify(base))).toBe('c552fd2b7c3cd16f4c4b5da0ddf703892ea5c2239323ba9266caf8a11e38a679');
    expect(extension.products.map(p=>[p.name,p.price_cents,p.colors])).toEqual([
      ['Remera Oversize Hueso — DEMO',2700000,['Blanco Hueso','Negro']],
      ['Buzo Essential Melange — DEMO',5300000,['Gris Melange','Grafito']],
      ['Pantalón Relaxed Piedra — DEMO',5000000,['Beige Piedra','Negro']],
      ['Conjunto Urban Gris Claro — DEMO',7800000,['Gris Claro','Grafito']],
    ]);
    expect(all.products).toHaveLength(12);
    for(const product of extension.products) {
      expect(product.variants).toHaveLength(8);
      expect(product.image.storage_path).toBe(`vanta-demo-v2/${product.slug.replace('vanta-demo-','')}/front.png`);
      expect(product.variants.map(v=>v.size)).toEqual(['S','M','L','XL','S','M','L','XL']);
      expect(new Set(product.variants.map(v=>v.sku)).size).toBe(8);
    }
    expect(()=>selectCatalog('otro')).toThrow(/Ámbito/);
    const invalid=JSON.parse(JSON.stringify(extensionCatalog()));
    invalid.products[0].image.storage_path='vanta-demo-v2/remera-oversize-hueso.png';
    expect(()=>extensionCatalog(invalid)).toThrow(/Ruta/);
  });
  it('agrega solo cuatro modelos, repite sin duplicados y preserva originales, stock, pedidos, pagos y reservas',async()=>{
    await db.exec(baseSeed);
    const variant=base.products[0].variants[0].id;
    await db.query('update public.inventory set on_hand=4,reserved=1 where variant_id=$1',[variant]);
    await db.query('update public.products set description=description || $1 where id=$2',[' Nota del operador.',base.products[0].id]);
    const order='00000000-0000-0000-0000-000000000101';
    const item='00000000-0000-0000-0000-000000000102';
    await db.exec(`insert into public.orders(id,idempotency_key,request_hash,first_name,last_name,email,phone,subtotal_cents)
      values ('${order}',gen_random_uuid(),repeat('a',64),'Test','Demo','demo@example.com','12345678',2500000);
      insert into public.order_items(id,order_id,variant_id,product_name,sku,size,color,quantity,unit_price_cents)
      values ('${item}','${order}','${variant}','Demo','DEMO','S','Negro',1,2500000);
      insert into public.payments(order_id,method,idempotency_key,amount_cents)
      values ('${order}','bank_transfer',gen_random_uuid(),2500000);
      insert into public.stock_reservations(order_id,order_item_id,variant_id,quantity,expires_at)
      values ('${order}','${item}','${variant}',1,now()+interval '1 hour');`);
    const before=await baseSnapshot();
    const [block,summary]=buildDemoStatements(extension,PROJECT_REF);
    await db.query(block);
    await db.exec('discard all');
    expect((await db.query(summary)).rows[0]).toEqual({demo_products:4,demo_variants:32,demo_images:4,demo_inventory_rows:32,catalog_products:12,catalog_variants:96,catalog_images:12,catalog_inventory_rows:96});
    expect(await baseSnapshot()).toEqual(before);
    const newVariant=extension.products[0].variants[0].id;
    await db.query('update public.inventory set on_hand=2,reserved=1 where variant_id=$1',[newVariant]);
    const inventory=(await db.query('select * from public.inventory order by variant_id')).rows;
    await db.exec(extensionSeed);
    expect(await baseSnapshot()).toEqual(before);
    expect((await db.query('select * from public.inventory order by variant_id')).rows).toEqual(inventory);
    for(const [table,n] of [['products',12],['product_variants',96],['product_images',12],['inventory',96]] as const) expect(await count(table)).toBe(n);
    expect((await db.query('select count(*)::int n from public.products group by category_id')).rows.map(r=>r.n)).toEqual([3,3,3,3]);
    await db.exec('set role anon');
    expect((await db.query('select * from public.products')).rows).toHaveLength(12);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(12);
    await expect(db.query('select * from public.inventory')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('rechaza una base incompleta o una foto nueva ausente antes de agregar registros',async()=>{
    await expect(db.exec(extensionSeed)).rejects.toThrow(/catálogo inicial completo/);
    expect(await count('products')).toBe(0);
    await db.exec(baseSeed);
    await db.query('delete from storage.objects where name=$1',[extension.products[0].image.storage_path]);
    const before=await baseSnapshot();
    await expect(db.exec(extensionSeed)).rejects.toThrow(/Faltan fotografías/);
    expect(await count('products')).toBe(8);
    expect(await baseSnapshot()).toEqual(before);
  });
  it('cancela toda la ampliación ante un slug ajeno en conflicto sin reemplazarlo',async()=>{
    await db.exec(baseSeed);
    await db.query(`insert into public.products(category_id,name,slug,price_cents,active)
      select id,'Ajeno',$1,123,true from public.categories where slug='remeras'`,[extension.products[0].slug]);
    const before=await baseSnapshot();
    await expect(db.exec(extensionSeed)).rejects.toThrow(/Colisión/);
    expect(await count('products')).toBe(9);
    expect(await count('product_variants')).toBe(64);
    expect(await baseSnapshot()).toEqual(before);
    expect((await db.query('select price_cents from public.products where slug=$1',[extension.products[0].slug])).rows[0].price_cents).toBe(123);
  });
  it('el seed completo para una base local vacía crea 12/96/12/96 y también es idempotente',async()=>{
    const seed=buildDemoSql(all,PROJECT_REF);
    await db.exec(seed);
    const before=(await db.query('select * from public.products order by id')).rows;
    await db.exec(seed);
    expect((await db.query('select * from public.products order by id')).rows).toEqual(before);
    for(const [table,n] of [['products',12],['product_variants',96],['product_images',12],['inventory',96]] as const) expect(await count(table)).toBe(n);
  });
});
