// @vitest-environment node
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWorkOutput } from '../../scripts/prepare-demo-catalog.mjs';

// Exercise both Node path implementations on every host, without requiring a
// Windows filesystem or assuming that Linux interprets backslashes as separators.
describe.each([
  {platform:'Linux', paths:posix, root:'/home/operator/VANTA Urban Wear'},
  {platform:'Windows', paths:win32, root:'C:\\Repos\\VANTA Urban Wear'},
])('Salida segura en $platform',({paths,root})=>{
  it.each([
    'work/vanta-demo-load.sql',
    'work/nested/load.sql',
    'work/nested/../load.sql',
    paths.join('work','sql','load.sql'),
    paths.resolve(root,'work','vanta-demo-load.sql'),
  ])('acepta archivos internos relativos o absolutos: %s',output=>{
    expect(resolveWorkOutput(root,output,paths)).toBe(paths.resolve(root,output));
  });
  it.each([
    '', '.', 'work', 'work/', 'work/..',
    'outside.sql', '../outside.sql',
    'work/../outside.sql', 'work/nested/../../outside.sql',
    'work-other/load.sql',
    paths.resolve(root,'work-other','load.sql'),
    paths.resolve(root,'..','outside.sql'),
  ])('rechaza directorios, escapes y prefijos hermanos: %s',output=>{
    expect(()=>resolveWorkOutput(root,output,paths)).toThrow(/dentro de work/);
  });
});
describe('Detalles propios de Windows',()=>{
  const root='C:\\Repos\\VANTA Urban Wear';
  it('acepta backslashes de PowerShell y una ruta absoluta interna sin depender de mayúsculas',()=>{
    expect(resolveWorkOutput(root,'.\\work\\vanta-demo-load.sql',win32)).toBe(root+'\\work\\vanta-demo-load.sql');
    expect(resolveWorkOutput(root,'c:\\repos\\vanta urban wear\\WORK\\load.sql',win32)).toBe('c:\\repos\\vanta urban wear\\WORK\\load.sql');
  });
  it.each([
    'work\\..\\outside.sql',
    'work\\nested/../../outside.sql',
    'C:\\outside.sql',
    'D:\\work\\load.sql',
    'D:work\\load.sql',
    '\\\\server\\share\\work\\load.sql',
    'C:\\Repos\\VANTA Urban Wear\\work-other\\load.sql',
  ])('rechaza traversal, otras unidades y UNC externas: %s',output=>{
    expect(()=>resolveWorkOutput(root,output,win32)).toThrow(/dentro de work/);
  });
  it('acepta una ruta UNC interna y rechaza otra carpeta compartida',()=>{
    const unc='\\\\server\\share\\VANTA';
    expect(resolveWorkOutput(unc,'work\\load.sql',win32)).toBe(unc+'\\work\\load.sql');
    expect(()=>resolveWorkOutput(unc,'\\\\server\\other-share\\VANTA\\work\\load.sql',win32)).toThrow(/dentro de work/);
  });
});
