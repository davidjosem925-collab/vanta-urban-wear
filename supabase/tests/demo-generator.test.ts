// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, selectCatalog, PROJECT_REF, ROOT } from '../../scripts/demo-catalog.mjs';
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
    expect(readFileSync(output,'utf8')).toBe(buildDemoSql(selectCatalog(),PROJECT_REF));
    expect(readFileSync(resolve(ROOT,'supabase/seeds/catalog.example.sql'),'utf8')).toBe(template);
    expect(template).toContain("confirmed_project_ref constant text := '';");
  });
  it('genera la ampliación explícita con solo cuatro productos y conserva la plantilla completa',()=>{
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const output=resolve(folder,'extension.sql');
    vi.spyOn(console,'log').mockImplementation(()=>{});
    runGenerator(['--scope=extension',`--confirm-project=${PROJECT_REF}`,`--output=${output}`]);
    expect(readFileSync(output,'utf8')).toBe(buildDemoSql(selectCatalog('extension'),PROJECT_REF));
    expect(readFileSync(resolve(ROOT,'supabase/seeds/catalog.extension.sql'),'utf8')).toBe(buildDemoSql(selectCatalog('extension')));
  });
  it('rechaza ámbitos desconocidos antes de generar SQL',()=>{
    expect(()=>runGenerator(['--scope=otro'])).toThrow(/Ámbito/);
  });
  it('rechaza otro proyecto y no genera un archivo ejecutable',()=>{
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const output=resolve(folder,'load.sql');
    expect(()=>runGenerator(['--confirm-project=otro',`--output=${output}`])).toThrow('Proyecto no autorizado');
    expect(existsSync(output)).toBe(false);
  });
  it('rechaza salida externa antes de crear archivos o directorios',()=>{
    const output=resolve(ROOT,'outside-demo-test','load.sql');
    expect(()=>runGenerator([`--confirm-project=${PROJECT_REF}`,`--output=${output}`])).toThrow(/dentro de work/);
    expect(existsSync(output)).toBe(false);
    expect(existsSync(resolve(ROOT,'outside-demo-test'))).toBe(false);
  });
  it('crea subcarpetas nuevas dentro de work',()=>{
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const output=resolve(folder,'new','nested','load.sql');
    vi.spyOn(console,'log').mockImplementation(()=>{});
    runGenerator([`--confirm-project=${PROJECT_REF}`,`--output=${output}`]);
    expect(readFileSync(output,'utf8')).toBe(buildDemoSql(selectCatalog(),PROJECT_REF));
  });
  // Windows symlink creation may require developer mode/admin privileges. The
  // path rules above are tested on all hosts; this filesystem check runs on Unix.
  it.skipIf(process.platform==='win32')('rechaza enlaces en carpetas y archivos sin sobrescribir sus destinos',()=>{
    mkdirSync(resolve(ROOT,'work'),{recursive:true});
    const folder=mkdtempSync(resolve(ROOT,'work/demo-generator-test-'));
    folders.push(folder);
    const target=resolve(folder,'target');
    mkdirSync(target);
    symlinkSync(target,resolve(folder,'linked'),'dir');
    const linkedOutput=resolve(folder,'linked','load.sql');
    expect(()=>runGenerator([`--confirm-project=${PROJECT_REF}`,`--output=${linkedOutput}`])).toThrow(/enlaces simbólicos/);
    expect(existsSync(resolve(target,'load.sql'))).toBe(false);
    const original=resolve(target,'original.sql');
    writeFileSync(original,'keep');
    const fileLink=resolve(folder,'load.sql');
    symlinkSync(original,fileLink);
    expect(()=>runGenerator([`--confirm-project=${PROJECT_REF}`,`--output=${fileLink}`])).toThrow(/enlaces simbólicos/);
    expect(readFileSync(original,'utf8')).toBe('keep');
  });
  it('rechaza rutas antiguas de Storage en la raíz aunque el PNG local sea válido',()=>{
    const source=JSON.parse(readFileSync(resolve(ROOT,'supabase/seeds/catalog.demo.json'),'utf8'));
    source.products[0].image.storage_path='vanta-demo-v1/remera-essential.png';
    expect(()=>catalog(source)).toThrow(/Ruta/);
  });
});
