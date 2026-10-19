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
export function id(value, version='vanta-demo-v1') {
  const h = hash(`${version}:${value}`).slice(0, 32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const colorCodes = {'Negro':'BLK','Grafito':'GRA','Blanco Hueso':'BONE','Gris Melange':'MEL','Beige Piedra':'STONE','Gris Claro':'LGR'};
function normalize(data,version,count,perCategory) {
  if (data.project_ref !== PROJECT_REF || data.version !== version || data.bucket !== 'product-images') throw new Error('Proyecto o versión no autorizados.');
  const slugs=['remeras','buzos','pantalones','conjuntos'];
  if (data.products.length !== count || data.categories.length !== 4 || new Set(data.products.map(p=>p.slug)).size !== count || data.categories.map(c=>c.slug).join(',') !== slugs.join(',')) throw new Error('Cantidad de productos o categorías inesperada.');
  if (data.sizes.join(',') !== 'S,M,L,XL' || data.on_hand_per_variant !== 6) throw new Error('Talles o stock inesperados.');
  if (version==='vanta-demo-v1' && data.colors?.join(',') !== 'Negro,Grafito') throw new Error('Colores originales inesperados.');
  for (const category of data.categories) {
    if (data.products.filter(p=>p.category_slug === category.slug).length !== perCategory) throw new Error('Cantidad de productos por categoría inesperada.');
  }
  const products = data.products.map(p=> {
    if (!/^vanta-demo-[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) || !p.name.endsWith(' — DEMO') || !Number.isSafeInteger(p.price_cents) || p.price_cents <= 0 || p.price_cents > 100000000000) throw new Error('Producto de demostración inválido.');
    const stem=p.slug.replace('vanta-demo-','');
    if (p.image.file !== `assets/${version}/${stem}.png` || p.image.storage_path !== `${version}/${stem}/front.png` || !p.image.alt.trim()) throw new Error('Ruta o texto de imagen inválidos.');
    const colors=version==='vanta-demo-v1'?data.colors:p.colors;
    if (!Array.isArray(colors) || colors.length!==2 || new Set(colors).size!==2 || colors.some(c=>!Object.hasOwn(colorCodes,c))) throw new Error('Dos colores válidos requeridos por producto.');
    return {...p,id:id(p.slug,version),image:{...p.image,id:id(p.slug+':image',version)},variants:colors.flatMap(color=>data.sizes.map(size=>({id:id(`${p.slug}:${color}:${size}`,version),sku:`VANTA-DEMO-${stem.toUpperCase()}-${colorCodes[color]}-${size}`,size,color})))};
  });
  return {...data, products};
}
// The original source and ID/SKU algorithm stay unchanged for the eight loaded models.
export function catalog(source) {
  return normalize(source ?? JSON.parse(readFileSync(resolve(SEEDS,'catalog.demo.json'),'utf8')),'vanta-demo-v1',8,2);
}
export function extensionCatalog(source) {
  return normalize(source ?? JSON.parse(readFileSync(resolve(SEEDS,'catalog.demo.extension.json'),'utf8')),'vanta-demo-v2',4,1);
}
export function selectCatalog(scope='all') {
  if (!['all','extension'].includes(scope)) throw new Error('Ámbito inválido: usar all o extension.');
  const base=catalog();
  const extension=extensionCatalog();
  if (JSON.stringify(base.categories)!==JSON.stringify(extension.categories)) throw new Error('La ampliación debe reutilizar las categorías originales.');
  const products=[...base.products,...extension.products];
  if (new Set(products.map(p=>p.slug)).size!==12 || new Set(products.map(p=>p.image.storage_path)).size!==12) throw new Error('La ampliación contiene duplicados.');
  return scope==='extension'
    ? {...extension,scope,baseline:base}
    : {...base,scope,products};
}
export function imageBytes(product) {
  const bytes = readFileSync(resolve(SEEDS,product.image.file));
  if (bytes.length > 5242880 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || hash(bytes) !== product.image.sha256) throw new Error(`Archivo PNG ausente, alterado o demasiado grande: ${product.image.file}`);
  return bytes;
}
