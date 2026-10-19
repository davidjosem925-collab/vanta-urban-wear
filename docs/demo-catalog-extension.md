# Ampliación demo 8 → 12: preparación y carga aprobada en Windows

Esta entrega **no ejecuta SQL ni carga archivos contra Supabase remoto**. El
operador confirmó que VANTA ya tiene 8 productos, 64 variantes, 8 fotos y 64 filas
de inventario. Todo lo siguiente se prepara localmente; las escrituras remotas
se realizan únicamente después de revisar y aprobar estos archivos.

## Contenido a aprobar

| Producto nuevo | Precio ficticio ARS | Colores (principal primero) |
| --- | ---: | --- |
| Remera Oversize Hueso — DEMO | $27.000 | Blanco Hueso / Negro |
| Buzo Essential Melange — DEMO | $53.000 | Gris Melange / Grafito |
| Pantalón Relaxed Piedra — DEMO | $50.000 | Beige Piedra / Negro |
| Conjunto Urban Gris Claro — DEMO | $78.000 | Gris Claro / Grafito |

Cada modelo incluye S/M/L/XL, 8 variantes y una foto original generada con IA en
su color claro principal, sobre cemento gris. No se obtuvieron fotos de otras
tiendas. La imagen no cambia al seleccionar la alternativa oscura: sigue siendo
la foto principal ilustrativa, como aclara la descripción. No se inventan fotos
adicionales ni descuentos. Los importes se almacenan en centavos ARS.

Stock **solo de demostración**: 6 unidades iniciales por variante nueva,
`reserved=0` (192 unidades adicionales). Repetir no repone stock ni reinicia reservas,
incluso si el operador cambió las cantidades después. El inventario sigue privado:
el frontend conserva “Stock por confirmar”, sin habilitar compras.

## Archivos e identidades

- `supabase/seeds/catalog.demo.json`: ocho originales **sin cambios**.
- `supabase/seeds/catalog.demo.extension.json`: los cuatro nuevos, sus colores,
  precios, rutas y SHA-256 de las fotos.
- `supabase/seeds/assets/vanta-demo-v1/`: ocho originales **sin cambios**.
- `supabase/seeds/assets/vanta-demo-v2/`: cuatro PNG nuevos, todos menores de 5 MiB.
- `supabase/seeds/catalog.extension.sql`: plantilla incremental, sin confirmación.
- `supabase/seeds/catalog.example.sql`: plantilla completa de 12 modelos para una
  instalación local vacía; **no es el procedimiento recomendado para ampliar la
  base que ya contiene ocho**.

El generador conserva el algoritmo de UUID/SKU original para v1. La ampliación usa
su propio namespace v2 para UUID e imágenes, sin reutilizar objetos existentes.
Cada SKU nuevo incluye un código de color estable. Los tests verifican una huella
exacta de todo el manifiesto original normalizado (identidades, precios, SKU y fotos).

## 1. Actualizar y validar localmente (PowerShell)

Desde la raíz del repositorio, con Node 24:

```powershell
git switch feat/stage-2-catalog
git pull --ff-only origin feat/stage-2-catalog
npm ci
npm run demo:check
npm run demo:upload -- --scope=extension
npm run check
```

`demo:check` verifica ambos SQL y las 12 fotos locales. `demo:upload` sin `--apply`
es **un plan local sin acceso remoto ni credenciales**; debe anunciar 4 archivos,
ámbito `extension`. No ejecuta SQL.

## 2. Generar el SQL confirmado, todavía sin ejecutarlo

```powershell
$demoSql = Join-Path (Get-Location).Path 'work\vanta-demo-extension.sql'
npm run demo:prepare -- --scope=extension --confirm-project=evlbfjvvljbkntlozokt "--output=$demoSql"
Get-Content -Raw -Encoding UTF8 $demoSql
```

Se aceptan también `--output=work/vanta-demo-extension.sql` y rutas absolutas
**internas a work/**, con espacios. Se mantienen las validaciones Windows/Linux
contra escapes, unidades/UNC externos y enlaces simbólicos. El script correcto
es `demo:prepare`, no `demo`. La plantilla versionada deja la confirmación vacía;
para cargar se utiliza exclusivamente la copia generada en `work/`.

Revisar el archivo: ámbito `extension`, cuatro productos nuevos y 32 variantes.
Los ocho originales figuran **solo en comprobaciones de lectura y resumen**.
No editar manualmente UUID, SKU, rutas ni precios. Regenerar si se cambia el JSON.

## 3. Después de la aprobación: subir solo las cuatro fotos nuevas

Proyecto exacto: **`evlbfjvvljbkntlozokt`**. Bucket existente **privado**:
`product-images`. No cambiar el bucket, las políticas RLS ni las ocho fotos v1.

| Archivo en `supabase/seeds/assets/vanta-demo-v2/` | Ruta exacta dentro de `product-images` |
| --- | --- |
| `remera-oversize-hueso.png` | `vanta-demo-v2/remera-oversize-hueso/front.png` |
| `buzo-essential-melange.png` | `vanta-demo-v2/buzo-essential-melange/front.png` |
| `pantalon-relaxed-piedra.png` | `vanta-demo-v2/pantalon-relaxed-piedra/front.png` |
| `conjunto-urban-gris-claro.png` | `vanta-demo-v2/conjunto-urban-gris-claro/front.png` |

Opción reproducible en PowerShell: obtener una credencial secreta de operador del
proyecto VANTA y usarla **solo en la terminal privada**, fuera de archivos,
historial, logs y variables `VITE_*`. No activar trazas de comandos.

```powershell
$demoSecret = Read-Host 'Clave secreta de servidor de VANTA' -AsSecureString
$demoOldProxy = $env:NODE_USE_ENV_PROXY
try {
    $env:VANTA_DEMO_SUPABASE_URL = 'https://evlbfjvvljbkntlozokt.supabase.co'
    $env:VANTA_DEMO_SUPABASE_SECRET_KEY = ([System.Net.NetworkCredential]::new('', $demoSecret)).Password
    $env:NODE_USE_ENV_PROXY = '1'
    npm run demo:upload -- --scope=extension --apply --confirm-project=evlbfjvvljbkntlozokt
    if ($LASTEXITCODE -ne 0) { throw 'Carga/verificación incompleta: no ejecutar SQL.' }
}
finally {
    Remove-Item Env:VANTA_DEMO_SUPABASE_SECRET_KEY, Env:VANTA_DEMO_SUPABASE_URL -ErrorAction SilentlyContinue
    $env:NODE_USE_ENV_PROXY = $demoOldProxy
    $demoSecret.Dispose()
}
```

El CLI valida los cuatro PNG y hashes locales, verifica el bucket existente,
comprueba los objetos v2 existentes y sube únicamente faltantes con `upsert:false`.
Nunca reemplaza bytes diferentes. Al finalizar descarga y verifica **esas cuatro
rutas**, sin leer/subir/reemplazar las ocho fotos v1. Si falla a mitad, repetir el
mismo comando retoma faltantes. Solo continuar cuando confirme cuatro verificadas.
No dejar la variable secreta disponible al ejecutar Vite o un build.

Alternativa: subir esos cuatro PNG desde Storage del Dashboard con los nombres
y carpetas exactos de la tabla, sin reemplazar objetos existentes. El CLI ofrece
verificación SHA-256 reproducible; revisar manualmente rutas/bytes si no se usa.
No usar `vanta-demo-v2/remera-oversize-hueso.png` como ruta remota: ese nombre es
solo el archivo local, y no coincide con la ruta `.../front.png`.

## 4. Después de la aprobación y de verificar las fotos: SQL Editor

1. Verificar visualmente en Dashboard que se está en `evlbfjvvljbkntlozokt`.
2. Abrir una consulta nueva en SQL Editor y pegar **todo** el archivo confirmado
   `work/vanta-demo-extension.sql`. Quitar cualquier selección parcial.
3. Ejecutarlo completo una sola vez como operador autorizado. No anteponer `SET`,
   `BEGIN`, `COMMIT` ni ejecutar instrucciones internas del bloque por separado.
4. Verificar el resultado:

| Columnas del resumen | Resultado esperado |
| --- | ---: |
| `demo_products` / `demo_variants` / `demo_images` / `demo_inventory_rows` | 4 / 32 / 4 / 32 |
| `catalog_products` / `catalog_variants` / `catalog_images` / `catalog_inventory_rows` | 12 / 96 / 12 / 96 |

Las primeras columnas cuentan los registros del alcance nuevo, no cuántos se
insertaron en esa ejecución: siguen mostrando 4/32/4/32 al repetir.
Los totales están limitados a los doce UUID esperados, no a otros productos del
proyecto. La confirmación de texto no demuestra la identidad de la base: verificar
siempre el destino en Dashboard.

El bloque `DO` contiene todas las escrituras y controles, sin tablas temporales
ni dependencia de sesiones persistentes. Antes de insertar exige los ocho modelos
originales activos y sus categorías activas, las 64 variantes e inventarios
originales y las ocho asociaciones/rutas de fotos existentes. No compara ni cambia
las cantidades de stock originales, sus reservas, sus precios o descripciones.
Si falta parte de la base, **aborta sin reconstruirla**. Si faltan fotos v2 o hay
una colisión en modelos/variantes/imágenes nuevos, revierte toda la ampliación.
El resumen posterior es de solo lectura y funciona incluso en otra petición.

No seguir ignorando errores ni borrar registros para “hacerlo funcionar”. Una
carga vieja del SQL confirmado de ocho productos sigue siendo idempotente, pero
no amplía el catálogo: utilizar el archivo generado con `--scope=extension`.

## 5. Verificaciones posteriores

Con las dos variables públicas de Vite y ninguna credencial administrativa:

```powershell
$env:NODE_USE_ENV_PROXY = '1'
npm run verify:supabase
npm run dev
```

Comprobar tres modelos por categoría, ficha de cada modelo nuevo, imágenes firmadas,
talles S/M/L/XL, ambos colores y precio correcto. La foto permanece en el color
principal aunque se seleccione la alternativa. Revisar escritorio y móvil.
`verify:supabase` cuenta filas públicas de todo el proyecto y firma una imagen de
muestra: revisar visualmente las cuatro nuevas, no asumir que ese único smoke test
certifica todas las fotos.

## Riesgos y pendientes antes de aprobar

- Revisar y aprobar las cuatro fotos, colores, descripciones y precios ficticios.
- Confirmar destino, catálogo inicial y credencial autorizada. No se inspeccionó
  el esquema remoto en esta entrega; las pruebas SQL usan las migraciones actuales
  y PostgreSQL embebido con contratos Auth/Storage simulados.
- Storage y SQL no comparten una transacción. Si el SQL falla, las fotos v2 pueden
  quedar privadas y sin asociación; conservarlas y resolver la causa, sin borrado
  automático. El SQL verifica nombres de objeto; el CLI es quien verifica bytes.
- Un conflicto se revisa, nunca se resuelve con un upsert que sobrescriba datos.
- Inventario privado, sin carrito, checkout, pagos reales ni panel administrativo.
- La revisión responsive local usa los doce modelos y fotos locales; la firma y
  entrega de las nuevas imágenes remotas se verifican después de la carga aprobada.
