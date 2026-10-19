// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { syncDemoPhotos } from '../../scripts/demo-storage.mjs';
const files = ['a','b'].map(name=>({product:{image:{storage_path:`vanta-demo-v1/${name}/front.png`}},bytes:Buffer.from(name)}));
function fakeStorage() {
  const objects=new Map<string,Buffer>();
  const download=vi.fn(async (path: string)=>objects.has(path)
    ? {data:new Blob([new Uint8Array(objects.get(path)!)]),error:null}
    : {data:null,error:{statusCode:'404',message:'Object not found'}});
  const upload=vi.fn(async(path: string,bytes: Buffer,options: {upsert: boolean})=>{
    expect(options.upsert).toBe(false);
    if(objects.has(path)) return {error:{message:'already exists'}};
    objects.set(path,bytes);
    return {error:null};
  });
  return {objects,download,upload};
}
describe('Carga de fotos demo sin red ni credenciales',()=>{
  it('carga solo faltantes, valida bytes y repite sin sobrescribir',async()=>{
    const storage=fakeStorage();
    storage.objects.set('other-project/keep.png',Buffer.from('untouched'));
    expect(await syncDemoPhotos(storage,files)).toBe(2);
    expect(await syncDemoPhotos(storage,files)).toBe(0);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.objects.get('other-project/keep.png')?.toString()).toBe('untouched');
  });
  it('aborta antes de escribir si cualquier ruta ya contiene bytes diferentes',async()=>{
    const storage=fakeStorage();
    storage.objects.set(files[1].product.image.storage_path,Buffer.from('different'));
    await expect(syncDemoPhotos(storage,files)).rejects.toThrow(/Conflicto/);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('no confunde una denegación de permisos con un archivo ausente',async()=>{
    const storage=fakeStorage();
    storage.download.mockResolvedValue({data:null,error:{statusCode:'403',message:'Forbidden'}});
    await expect(syncDemoPhotos(storage,files)).rejects.toThrow(/No se pudo comprobar/);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('permite retomar una carga parcial sin reemplazar el primer archivo',async()=>{
    const storage=fakeStorage();
    storage.upload.mockImplementationOnce(async(path,bytes)=>{
      storage.objects.set(path,bytes);return {error:null};
    }).mockImplementationOnce(async()=>({error:{message:'network failure'}}));
    await expect(syncDemoPhotos(storage,files)).rejects.toThrow(/Carga interrumpida/);
    expect(await syncDemoPhotos(storage,files)).toBe(1);
    expect(storage.objects.size).toBe(2);
  });
});
