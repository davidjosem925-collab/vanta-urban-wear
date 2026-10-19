/** Operator CLI, explicit opt-in only. Never loaded by Vite. */
import { createClient } from '@supabase/supabase-js';
import { selectCatalog, imageBytes, ORIGIN, PROJECT_REF } from './demo-catalog.mjs';
import { syncDemoPhotos } from './demo-storage.mjs';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const scope=args.find(a=>a.startsWith('--scope='))?.slice('--scope='.length) ?? 'all';
if (args.some(a=>!['--apply',`--confirm-project=${PROJECT_REF}`,`--scope=${scope}`].includes(a))) throw new Error('Argumentos no reconocidos.');
const data = selectCatalog(scope);
const files = data.products.map(p=>({product:p, bytes:imageBytes(p)}));
if (!apply) {
  console.log(`DRY RUN local: ${files.length} fotografías PNG validadas; destino ${PROJECT_REF}/product-images, ámbito ${scope}. Sin acceso remoto.`);
} else {
  if (!args.includes(`--confirm-project=${PROJECT_REF}`)) throw new Error('Falta confirmación explícita del proyecto VANTA.');
  if (process.env.VANTA_DEMO_SUPABASE_URL !== ORIGIN) throw new Error('URL no autorizada: solo el proyecto VANTA exacto.');
  const key = process.env.VANTA_DEMO_SUPABASE_SECRET_KEY;
  if (!key || key === process.env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('Falta credencial de operador en VANTA_DEMO_SUPABASE_SECRET_KEY. Nunca usar VITE_*.');
  // Node in Codex needs NODE_USE_ENV_PROXY=1. Preserve inherited proxy and TLS trust.
  const client = createClient(ORIGIN,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
  const {data:bucket,error:bucketError} = await client.storage.getBucket(data.bucket);
  if(bucketError || !bucket || bucket.public || bucket.file_size_limit !== 5242880 || !bucket.allowed_mime_types?.includes('image/png')) throw new Error('No se pudo validar el bucket privado existente. No se crea ni modifica.');
  const storage=client.storage.from(data.bucket);
  const uploaded=await syncDemoPhotos(storage,files);
  console.log(`OK: ${files.length} fotografías verificadas (${uploaded} nuevas). No se ejecutó SQL ni se modificaron registros de catálogo.`);
}
