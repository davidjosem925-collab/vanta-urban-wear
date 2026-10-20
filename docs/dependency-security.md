# Corrección de auditoría de dependencias — 20 de octubre de 2026

Rama `fix/vitest-audit`, creada desde `main` actualizado (`b849fef`), después de
fusionar la etapa 3. Esta corrección no comienza la etapa 4 ni implementa checkout.

## Diagnóstico y alcance

`package.json` declaraba `vitest: ^3.2.4`; el lockfile instalaba Vitest **3.2.7**,
`@vitest/mocker` **3.2.7** y `tinypool` **1.1.1**. Todos pertenecían exclusivamente
al árbol de `devDependencies` de Vitest.

| Aviso | Dependencia y rango informado por npm audit | Corrección |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), moderado | Vitest / mocker `>=2.1.0 <4.1.11`, lectura arbitraria de archivos por redirección de mocks | Vitest y mocker 4.1.12 |
| [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), crítico | tinypool `<=2.1.0`, gadget de prototype pollution en opciones de workers que puede conducir a ejecución de código | tinypool eliminado del árbol |
| [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), crítico | tinypool `<2.1.2`, gadget de prototype pollution en opciones de `run()` que puede conducir a ejecución de código | tinypool eliminado del árbol |

La auditoría inicial contaba tres paquetes afectados: mocker (moderado), tinypool
(crítico) y Vitest (crítico por propagación de su árbol). No equivale a tres fallos
independientes de la aplicación.

Son riesgos del entorno que ejecuta herramientas/pruebas y de los mecanismos de
mocks/workers bajo las condiciones descritas por los avisos, no evidencia de que
un visitante de la tienda pueda ejecutarlos. Las importaciones de Vitest están en
pruebas, su setup y la configuración Node de Vite; no en módulos de la aplicación
que se distribuyen al navegador. La configuración de build carga Vitest como
herramienta en Node, por lo que corregirlo también protege ese entorno de trabajo.
`npm audit --omit=dev` ya devolvía cero antes de la corrección. Las versiones e
integridades de todas las dependencias de producción se mantuvieron intactas.

Que sean dependencias de desarrollo no elimina el riesgo para desarrolladores y
CI. No se deben ejecutar pruebas de código no confiable con secretos o permisos
innecesarios, ni exponer servidores de pruebas como servicios públicos.

## Actualización elegida

Se actualizó explícitamente a `vitest: ^4.1.12` y se regeneró el lockfile con npm.
Vitest 4 usa su propio sistema de pools y ya no instala tinypool. Todos los paquetes
internos `@vitest/*` instalados quedan alineados en **4.1.12**.

Aunque npm proponía 5.0.5, la última versión de mantenimiento 4.1.12 también corrige
los avisos y soporta Node 22 y 24 y el Vite 7.3.7 ya instalado. Esto permite limitar
la migración a una versión mayor, conservar Vite y las herramientas restantes y
validar la compatibilidad con las pruebas actuales. No se usó `npm audit fix --force`,
no se forzaron dependencias transitivas mediante overrides y no se ignoraron avisos.

No fue necesario cambiar las expectativas de Vitest ni su configuración:
se conservan jsdom, el setup/cleanup explícito, las pruebas SQL locales en Node y
la suite de navegador existente. CI ahora ejecuta además `npm audit` completo como
comprobación obligatoria, sin filtrar severidades ni excluir desarrollo.

## Verificación reproducible

```bash
npm ci
npm ls vitest @vitest/mocker tinypool --all
npm audit
npm audit --omit=dev
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` ejecuta lint, todas las pruebas de Vitest y `tsc --noEmit` + build
Vite. Playwright cubre 1440, 820, 375 y 320 px con fixtures locales interceptados,
sin lecturas/escrituras a Supabase remoto. Las pruebas de migraciones, RLS y seeds
se ejecutan exclusivamente sobre PostgreSQL local en memoria. CI conserva también
la comprobación de imágenes en Ubuntu y Windows con Node 22.20.0 y checkout limpio.

Resultados de esta revisión:

- `npm ci` desde el lockfile actualizado: correcto.
- `npm audit` completo y `npm audit --omit=dev`: **0 vulnerabilidades**.
- `npm run check`: lint sin warnings, **197 pruebas** y TypeScript/build correctos.
- `npm run test:e2e`: **24 pruebas** de navegador en los cuatro anchos.
- Dependencias de producción y archivos de catálogo, PNG/WebP y SQL: sin cambios.

En el entorno local limitado a dos CPU, una primera ejecución simultánea de Vitest
y Playwright produjo fallos de tiempo/foco. No se reprodujeron al ejecutar la suite
de navegador completa por separado. En el Chromium de CI se detectó además que
la prueba de posición a 320 px medía antes del scroll automático al enfocar un
control. Se establece la referencia después de enfocarlo y se conserva el límite
de 1 px, con diagnóstico del scroll si falla; no se cambia el carrito ni sus estilos.
CI ejecuta ambas suites secuencialmente en su trabajo de comprobaciones.

No quedan vulnerabilidades residuales conocidas por la base de npm audit en esta
fecha. Este resultado depende de esa base y del lockfile auditado; no constituye
una garantía sobre vulnerabilidades aún no publicadas. Si aparece un aviso nuevo,
CI lo hará visible y deberá evaluarse antes de actualizar selectivamente.
