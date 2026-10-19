/** Storage-only synchronization, injectable for offline tests. No SDK or credentials here. */
import { hash } from './demo-catalog.mjs';
export async function syncDemoPhotos(storage,files) {
  // Preflight ALL paths before any writes; mismatched existing bytes abort, never overwrite.
  const pending=[];
  for(const file of files) {
    const {product,bytes}=file;
    const path=product.image.storage_path;
    const {data:existing,error}=await storage.download(path);
    if(!error && existing) {
      if(hash(Buffer.from(await existing.arrayBuffer())) !== hash(bytes)) throw new Error(`Conflicto de imagen: ${path}. No se sobrescribe.`);
    } else {
      // Storage uses 400/404 for missing objects; do not treat other failures as absence.
      if(!['404','400'].includes(String(error?.statusCode)) || !/not found|does not exist/i.test(error?.message??'')) throw new Error(`No se pudo comprobar ${path}. Revisar permisos/conexión; no se imprime la respuesta.`);
      pending.push(file);
    }
  }
  for(const {product,bytes} of pending) {
    const path=product.image.storage_path;
    const {error}=await storage.upload(path,bytes,{contentType:'image/png',upsert:false,cacheControl:'3600'});
    if(error) throw new Error(`Carga interrumpida en ${path}; no se sobrescribe. Repetir el comando después de revisar la causa.`);
  }
  // Verify all bytes, including previous uploads and partially completed previous runs.
  for(const {product,bytes} of files) {
    const {data:download,error}=await storage.download(product.image.storage_path);
    if(error || !download || hash(Buffer.from(await download.arrayBuffer())) !== hash(bytes)) throw new Error('Verificación final de fotografías fallida. No ejecutar el SQL todavía.');
  }
  return pending.length;
}
