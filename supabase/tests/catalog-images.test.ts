// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { metadataSql, OUTPUT } from '../../scripts/prepare-catalog-images.mjs';
import { selectCatalog, imageBytes, hash, PROJECT_REF } from '../../scripts/demo-catalog.mjs';
import { buildDemoSql } from '../../scripts/prepare-demo-catalog.mjs';
import { createDemoDb } from './demo-fixture';

const manifest = JSON.parse(await readFile(resolve(OUTPUT,'manifest.json'),'utf8'));
describe('Optimización offline de fotografías privadas', () => {
  it('conserva los 12 originales y prepara 36 WebP íntegros y más livianos', async () => {
    const products=selectCatalog().products;
    expect(manifest.project_ref).toBe(PROJECT_REF); expect(manifest.records).toHaveLength(36);
    for (const product of products) {
      const original=imageBytes(product); const originalInfo=await sharp(original).metadata();
      const rows=manifest.records.filter(r=>r.original_id===product.image.id);
      expect(rows.map(r=>r.profile)).toEqual(['thumb','card','detail']);
      for(const row of rows) {
        const data=await readFile(resolve(OUTPUT,row.storage_path)); const info=await sharp(data).metadata();
        expect(hash(data)).toBe(row.sha256); expect(info.format).toBe('webp');
        expect(info.width).toBe(row.width); expect(info.height).toBe(row.height);
        expect(data.length).toBeLessThan(original.length); expect(row.product_id).toBe(product.id);
        expect(Math.abs(info.width!/info.height!-originalInfo.width!/originalInfo.height!)).toBeLessThan(.01);
      }
    }
  });
  it('SQL pendiente exige aprobación; carga confirmada es atómica, idempotente y conserva RLS', async () => {
    const all=selectCatalog(); const db=await createDemoDb();
    try {
      for(const p of all.products) await db.query("insert into storage.objects(bucket_id,name) values ('product-images',$1)",[p.image.storage_path]);
      await db.exec(buildDemoSql(all,PROJECT_REF));
      const before=(await db.query('select * from public.product_images order by id')).rows;
      const productsBefore=(await db.query('select * from public.products order by id')).rows;
      await expect(db.exec(metadataSql(manifest.records))).rejects.toThrow(/aprobación/);
      await expect(db.exec(metadataSql(manifest.records,PROJECT_REF))).rejects.toThrow(/incompatible/);
      expect((await db.query('select * from public.product_images order by id')).rows).toEqual(before);
      for(const row of manifest.records) await db.query("insert into storage.objects(bucket_id,name) values ('product-images',$1)",[row.storage_path]);
      const sql=metadataSql(manifest.records,PROJECT_REF);
      await db.exec(sql); await db.exec(sql);
      expect((await db.query('select count(*)::int n from public.product_images')).rows[0].n).toBe(48);
      const originalIds=all.products.map(p=>`'${p.image.id}'`).join(',');
      expect((await db.query(`select * from public.product_images where id in (${originalIds}) order by id`)).rows).toEqual(before);
      expect((await db.query('select * from public.products order by id')).rows).toEqual(productsBefore);
      await db.exec('set role anon');
      expect((await db.query('select count(*)::int n from storage.objects')).rows[0].n).toBe(48);
      await expect(db.exec(sql)).rejects.toThrow();
    } finally { await db.exec('reset role'); await db.close(); }
  },30000);
});
