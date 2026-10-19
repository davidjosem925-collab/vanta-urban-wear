/** Shared server/operator-only demo tooling. Never imported by the storefront. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_REF = 'evlbfjvvljbkntlozokt';
export const ORIGIN = `https://${PROJECT_REF}.supabase.co`;
export const SEEDS = resolve(ROOT, 'supabase/seeds');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function id(value) {
  const h = hash(`vanta-demo-v1:${value}`).slice(0, 32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function catalog(source) {
  const data = source ?? JSON.parse(readFileSync(resolve(SEEDS, 'catalog.demo.json'), 'utf8'));
  if (data.project_ref !== PROJECT_REF || data.version !== 'vanta-demo-v1' || data.bucket !== 'product-images') throw new Error('Proyecto o versión no autorizados.');
  if (data.products.length !== 8 || data.categories.length !== 4 || new Set(data.products.map(p=>p.slug)).size !== 8) throw new Error('Se requieren ocho productos únicos y cuatro categorías.');
  if (data.sizes.join(',') !== 'S,M,L,XL' || data.colors.join(',') !== 'Negro,Grafito' || data.on_hand_per_variant !== 6) throw new Error('Variantes o stock inesperados.');
  for (const category of data.categories) {
    if (data.products.filter(p=>p.category_slug === category.slug).length !== 2) throw new Error('Cada categoría requiere dos productos.');
  }
  const products = data.products.map(p=> {
    if (!/^vanta-demo-[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) || !p.name.endsWith(' — DEMO') || !Number.isSafeInteger(p.price_cents) || p.price_cents <= 0 || p.price_cents > 100000000000) throw new Error('Producto de demostración inválido.');
    const stem=p.slug.replace('vanta-demo-','');
    if (p.image.file !== `assets/vanta-demo-v1/${stem}.png` || p.image.storage_path !== `vanta-demo-v1/${stem}/front.png` || !p.image.alt.trim()) throw new Error('Ruta o texto de imagen inválidos.');
    return {...p,id:id(p.slug),image:{...p.image,id:id(p.slug+':image')},variants:data.colors.flatMap((color,c)=>data.sizes.map(size=>({id:id(`${p.slug}:${color}:${size}`),sku:`VANTA-DEMO-${stem.toUpperCase()}-${c===0?'BLK':'GRA'}-${size}`,size,color})))};
  });
  return {...data, products};
}
export function imageBytes(product) {
  const bytes = readFileSync(resolve(SEEDS,product.image.file));
  if (bytes.length > 5242880 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || hash(bytes) !== product.image.sha256) throw new Error(`Archivo PNG ausente, alterado o demasiado grande: ${product.image.file}`);
  return bytes;
}
