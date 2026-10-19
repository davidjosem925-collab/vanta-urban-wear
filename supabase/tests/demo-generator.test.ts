// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, PROJECT_REF, ROOT } from '../../scripts/demo-catalog.mjs';
import { buildDemoSql, runGenerator } from '../../scripts/prepare-demo-catalog.mjs';
const folders: string[]=[];
afterEach(()=>{ vi.restoreAllMocks(); for(const folder of folders.splice(0)) rmSync(folder,{recursive:true,force:true}); });
describe('Generador permanente del seed para SQL Editor',()=>{
  it('genera el archivo confirmado sin SET externo ni alterar la plantilla segura',()=>{
    const template=readFileSync(resolve(ROOT,'supabase/seeds/catalog.example.sql'),'utf8');
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const output=resolve(folder,'load.sql');
    vi.spyOn(console,'log').mockImplementation(()=>{});
    runGenerator([`--confirm-project=${PROJECT_REF}`,`--output=${output}`]);
    expect(readFileSync(output,'utf8')).toBe(buildDemoSql(catalog(),PROJECT_REF));
    expect(readFileSync(resolve(ROOT,'supabase/seeds/catalog.example.sql'),'utf8')).toBe(template);
    expect(template).toContain("confirmed_project_ref constant text := '';");
  });
  it('rechaza otro proyecto y no genera un archivo ejecutable',()=>{
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const output=resolve(folder,'load.sql');
    expect(()=>runGenerator(['--confirm-project=otro',`--output=${output}`])).toThrow('Proyecto no autorizado');
    expect(existsSync(output)).toBe(false);
  });
  it('rechaza rutas antiguas de Storage en la raíz aunque el PNG local sea válido',()=>{
    const source=JSON.parse(readFileSync(resolve(ROOT,'supabase/seeds/catalog.demo.json'),'utf8'));
    source.products[0].image.storage_path='vanta-demo-v1/remera-essential.png';
    expect(()=>catalog(source)).toThrow(/Ruta/);
  });
});
