# Carga del catálogo demo de VANTA en SQL Editor

**Esta corrección se comprobó solo localmente; no ejecuta el seed remoto.**
No hay migraciones nuevas ni cambios de políticas RLS. La PR #2 permanece sin
fusionar. Si el operador ya cargó y verificó las ocho fotos, conservarlas y pasar
al paso 3; no es necesario volver a cargarlas. La ejecución de escritura debe
contar con aprobación del operador.

## Alcance revisable

Destino único: `https://evlbfjvvljbkntlozokt.supabase.co` (VANTA).
Bucket **privado** existente: `product-images`; prefijo exclusivo `vanta-demo-v1/`.

| Categoría | Producto ficticio | Precio ficticio ARS |
| --- | --- | ---: |
| Remeras | Remera Essential — DEMO | $25.000 |
| Remeras | Remera Box — DEMO | $29.000 |
| Buzos | Buzo Core — DEMO | $55.000 |
| Buzos | Buzo Relax — DEMO | $49.000 |
| Pantalones | Pantalón Forma — DEMO | $48.000 |
| Pantalones | Pantalón Cargo — DEMO | $52.000 |
| Conjuntos | Conjunto Studio — DEMO | $80.000 |
| Conjuntos | Conjunto Weekend — DEMO | $76.000 |

Cada producto tiene descripción explícita de demo, precio en **centavos ARS**,
una fotografía original generada con IA y texto alternativo. Talles S/M/L/XL y
colores Negro/Grafito: **8 variantes por producto, 64 en total**. Stock inicial:
6 unidades por variante, `reserved=0`: **384 unidades ficticias**. Una foto por
modelo; no representa todos los colores. No se agregan compradores, pedidos,
reservas, pagos ni funcionalidades de compra.

El inventario sigue siendo privado. El frontend actual mostrará **stock por
confirmar**: insertar stock no habilita su lectura pública ni autoriza a prometer
existencias reales. Las imágenes se siguen leyendo mediante URLs firmadas.

## Archivos

- `supabase/seeds/catalog.demo.json`: fuente de datos y SHA-256 de cada PNG.
- `supabase/seeds/catalog.example.sql`: seed completo generado, transaccional;
  plantilla segura sin confirmación, generada sin tablas temporales.
  Para SQL Editor se genera una copia confirmada en `work/` (paso 3).
- `supabase/seeds/assets/vanta-demo-v1/*.png`: ocho originales. Procedencia en
  `supabase/seeds/assets/README.md`. No son fotos de otras tiendas.
- `scripts/prepare-demo-catalog.mjs`: genera SQL localmente; `--check` detecta
  desactualización del SQL o fotos alteradas.
- `scripts/upload-demo-images.mjs`: operador de Storage, seco por defecto.
- `supabase/tests/demo-seed.test.ts`: PostgreSQL embebido con ambas migraciones
  actuales; repetición, conflictos, preservación del stock y RLS.

## 1. Preparar y revisar sin acceso remoto

Desde el repositorio, con Node 24:

```bash
git switch feat/stage-2-catalog
npm ci
npm run demo:check
npm run demo:upload
npm run check
```

`demo:upload` **sin argumentos** valida los ocho archivos locales y muestra el
plan; no necesita credenciales ni realiza solicitudes. Si se edita el JSON,
regenerar con `npm run demo:prepare` y revisar el diff. La carga requiere las dos
migraciones existentes ya aplicadas; no usar `supabase db reset`, `db push` ni
semillas automáticas para este procedimiento.

## 2. Tras la aprobación: subir primero las ocho fotografías

Abrir el Dashboard y verificar explícitamente el proyecto cuyo ref es
`evlbfjvvljbkntlozokt`. Obtener allí una credencial **secreta de servidor** o
`service_role` autorizada para ese proyecto. Solo se usa en una terminal privada
de operador, nunca en el frontend, archivos `.env`, comandos de build, commits,
logs ni variables `VITE_*`. No crear administradores ni cambiar RLS para cargar.

En Bash, introducir la clave sin mostrarla ni escribirla en el historial:

```bash
export VANTA_DEMO_SUPABASE_URL='https://evlbfjvvljbkntlozokt.supabase.co'
read -r -s -p 'Clave secreta del proyecto VANTA: ' VANTA_DEMO_SUPABASE_SECRET_KEY
printf '\n'
export VANTA_DEMO_SUPABASE_SECRET_KEY
NODE_USE_ENV_PROXY=1 npm run demo:upload -- --apply --confirm-project=evlbfjvvljbkntlozokt
unset VANTA_DEMO_SUPABASE_SECRET_KEY VANTA_DEMO_SUPABASE_URL
```

No activar `set -x`. En Codex, `NODE_USE_ENV_PROXY=1` permite a Node usar el proxy
y el dominio permitido del entorno; se mantiene la verificación TLS.

El CLI limita el origen al proyecto VANTA exacto. Comprueba el bucket privado y
sus límites antes de cargar; compara todos los archivos remotos existentes por
SHA-256 y **no sobrescribe ninguno**. Carga solo faltantes con `upsert:false` y
verifica los ocho originales descargándolos. Si falla una carga, no ejecutar el
SQL: corregir la causa y repetir. Una repetición omite los archivos idénticos.
Los ocho PNG deben ser menores que 5 MiB y se almacenan como `image/png`.

Alternativa sin clave en terminal: subir manualmente los mismos ocho archivos
mediante Storage del Dashboard, conservando exactamente `image.storage_path`
de cada entrada del JSON. No hacer público el bucket ni reemplazar objetos
existentes diferentes. El CLI es la opción reproducible con verificación de bytes.

## 3. Generar y ejecutar una copia confirmada en SQL Editor

Actualizar primero la rama (no usar una copia anterior del SQL guardada en el
Dashboard):

```bash
git switch feat/stage-2-catalog
git pull --ff-only origin feat/stage-2-catalog
npm ci
npm run demo:check
npm run demo:prepare -- --confirm-project=evlbfjvvljbkntlozokt --output=work/vanta-demo-load.sql
```

### PowerShell y rutas de Windows

El script del repositorio se llama **`demo:prepare`**, no `demo`. Desde la raíz
del checkout, este comando funciona en PowerShell y también acepta `/`:

```powershell
npm run demo:prepare -- --confirm-project=evlbfjvvljbkntlozokt --output=work/vanta-demo-load.sql
```

Con separadores nativos y un archivo de salida absoluto dentro de `work/`:

```powershell
$demoOutput = Join-Path (Get-Location).Path 'work\vanta-demo-load.sql'
npm run demo:prepare -- --confirm-project=evlbfjvvljbkntlozokt "--output=$demoOutput"
Get-Content -Raw -Encoding UTF8 $demoOutput
```

Las comillas conservan rutas con espacios como un único argumento. No se requiere
que el archivo exista; el generador crea sus subcarpetas. Las rutas relativas se
resuelven desde la raíz del repositorio. Ejecutar estos ejemplos en esa raíz.

La validación usa `node:path.resolve`, `relative`, `isAbsolute` y `sep`, no una
comparación de prefijos con `/`. Se rechazan `work/` como salida, destinos externos,
prefijos como `work-other`, escapes con `..`, otras unidades y recursos UNC externos.
Se rechazan también enlaces simbólicos/junctions en los componentes de salida.
Las pruebas ejercitan `path.win32` y `path.posix` desde Linux; eso verifica las
reglas de ambos sistemas, sin afirmar una ejecución nativa de PowerShell.

Estos comandos no se conectan a Supabase. La plantilla versionada
`supabase/seeds/catalog.example.sql` deja la confirmación vacía deliberadamente y
se niega a cargar datos. El generador produce `work/vanta-demo-load.sql` con la
confirmación **dentro del propio bloque**: no requiere editar SQL manualmente,
ni un `SET` en una ejecución anterior. `work/` está ignorado por Git.

En **SQL Editor del proyecto VANTA** y como operador autorizado:

1. Verificar el ref `evlbfjvvljbkntlozokt` en el Dashboard. El texto de confirmación
   del archivo es una barrera de intención, **no demuestra la identidad de la base**.
2. Crear una consulta nueva y pegar **todo** `work/vanta-demo-load.sql` recién
   generado. No usar el SQL antiguo ni anteponer `SET`, `BEGIN` o `COMMIT`.
3. Quitar cualquier selección parcial del editor y ejecutar el archivo completo,
   desde `DO $vanta_demo$` hasta el resumen final. No ejecutar las líneas internas
   del bloque por separado. El cierre puede usar otra etiqueta si los datos lo
   requieren; siempre copiar el archivo completo.
4. Esperar el resultado: **8 productos / 64 variantes / 8 imágenes / 64 filas
   de inventario**. Repetir este mismo archivo no duplica datos ni repone stock.

Todas las escrituras, controles y bloqueos viven en **una única sentencia DO
atómica**, sin tablas temporales y sin `COMMIT` interno. Una excepción revierte
las escrituras de ese bloque incluso si el cliente usa autocommit. El resumen es
un `SELECT` independiente sobre tablas permanentes e IDs incluidos en la consulta;
funciona también si se ejecuta en otra petición, después de confirmar la carga.
Un resumen aislado no realiza la carga ni demuestra que el bloque anterior corrió:
no seleccionarlo solo, y no ignorar un error del bloque aunque aparezca un resumen.

Ante cualquier error, detenerse y revisar el mensaje. No borrar imágenes,
productos ni tablas, no hacer `db reset` y no omitir controles. Las escrituras que
una ejecución **antigua por fragmentos** haya confirmado no se pueden deshacer con
un `ROLLBACK` posterior. El nuevo seed reconoce registros existentes compatibles
sin reemplazarlos; si encuentra diferencias, se detiene para revisión.

### Diagnóstico del error 42P01 y regresión

En la versión anterior, las cuatro tablas de trabajo se creaban como temporales
`ON COMMIT DROP`. PostgreSQL las elimina cuando termina su transacción. Por eso,
si se confirma la creación antes del siguiente `INSERT`, este falla con
`42P01: relation "vanta_demo_categories" does not exist`. Una conexión distinta
tampoco ve la tabla temporal. Cambiar a `ON COMMIT PRESERVE ROWS` no solucionaría
la dependencia de la conexión y dejaría estado entre ejecuciones.

**El SQL anterior completo, con su `BEGIN` y `COMMIT`, funciona dentro de la misma
transacción/conexión.** La regresión lo contrasta con la ejecución autocommit de
la creación, que reproduce exactamente el 42P01. El error recibido no prueba por
sí solo que SQL Editor separe siempre las sentencias ni permite distinguir entre
selección parcial, otra ejecución/conexión o un archivo viejo/modificado. No se
inspeccionó ni ejecutó el payload remoto durante esta corrección.

El código público de Studio elige el texto seleccionado si existe y, en caso
contrario, todo el editor. La ruta pública de pg-meta ejecuta el SQL recibido y
cierra su pool al terminar esa petición. Esto impide tratar ejecuciones distintas
como una sesión persistente garantizada. No hay fundamento para atribuir al editor
una división automática de todas las sentencias. La corrección elimina la
necesidad de esa continuidad en vez de depender de la configuración del editor.

Referencias primarias:

- [PostgreSQL: tablas temporales y ON COMMIT](https://www.postgresql.org/docs/current/sql-createtable.html).
- [Studio: selección del SQL que se ejecuta (`getEditorSql`)](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/SQLEditor/SQLEditor.utils.ts).
- [pg-meta: ejecución de `/query` y cierre del pool](https://github.com/supabase/postgres-meta/blob/master/src/server/routes/query.ts).
- [pg-meta: envío del SQL al cliente PostgreSQL](https://github.com/supabase/postgres-meta/blob/master/src/lib/db.ts).

### Rutas de imágenes: archivo local frente a Storage

Son rutas distintas por diseño: `image.file` identifica el PNG del repositorio;
`image.storage_path` identifica el objeto privado. No renombrar ni mover imágenes
ya verificadas. El generador y el uploader leen el mismo JSON. El SQL comprueba
y guarda exactamente estos nombres de objeto, **sin** URL ni prefijo del bucket:

```text
vanta-demo-v1/remera-essential/front.png
vanta-demo-v1/remera-box/front.png
vanta-demo-v1/buzo-core/front.png
vanta-demo-v1/buzo-relax/front.png
vanta-demo-v1/pantalon-forma/front.png
vanta-demo-v1/pantalon-cargo/front.png
vanta-demo-v1/conjunto-studio/front.png
vanta-demo-v1/conjunto-weekend/front.png
```

Por ejemplo, `assets/vanta-demo-v1/remera-essential.png` es el archivo local,
pero **no** su ruta remota. No usar `vanta-demo-v1/remera-essential.png` en Storage.
La validación compartida rechaza ese formato antiguo. Las regresiones verifican
la igualdad exacta JSON → SQL → `product_images.storage_path`, y que el seed
aborta sin publicar si solo existen objetos en la raíz.

### Idempotencia y colisiones

UUID, slugs, SKU y rutas son deterministas y exclusivos de `vanta-demo-v1`.
Las cuatro categorías se reutilizan por slug únicamente si sus nombres coinciden
y están activas. Las nuevas se crean activas. No se cambia una categoría oculta.
Ningún registro existente se actualiza: diferencias de ID, slug, contenido, SKU,
imagen o relación provocan **rollback de toda la transacción**. El stock y las
reservas existentes se conservan al repetir, incluso si cambiaron desde la carga.
No se repone stock ni se reactiva un producto ocultado. El bloqueo breve de tablas
serializa la operación; realizar la carga fuera de otras tareas de edición.

El viejo seed local usaba otros slugs: si alguien lo cargó anteriormente, esos
registros no se borran ni se renombran automáticamente. La carga agrega solamente
estos ocho modelos con prefijo `vanta-demo-`; puede haber otros productos en el
proyecto. Cualquier limpieza requiere una revisión separada. No se recorren ni
modifican otros proyectos, buckets o prefijos.

Storage y SQL **no comparten transacción**: si el SQL falla, las fotos ya subidas
pueden quedar sin asociación, aún privadas. Repetir no las duplica. No hay borrado
automático ni una limpieza general: conservarlas hasta resolver el conflicto.

## 4. Verificación posterior de solo lectura

En SQL Editor de VANTA, comparar el catálogo de demostración:

```sql
select c.name as categoria, p.name, p.slug, p.price_cents, p.currency,
       count(distinct v.id) as variantes,
       count(distinct i.id) as imagenes,
       sum(inv.on_hand) as stock_demo, sum(inv.reserved) as reservado
from public.products p
join public.categories c on c.id=p.category_id
join public.product_variants v on v.product_id=p.id
join public.inventory inv on inv.variant_id=v.id
join public.product_images i on i.product_id=p.id
where p.slug in (
  'vanta-demo-remera-essential','vanta-demo-remera-box',
  'vanta-demo-buzo-core','vanta-demo-buzo-relax',
  'vanta-demo-pantalon-forma','vanta-demo-pantalon-cargo',
  'vanta-demo-conjunto-studio','vanta-demo-conjunto-weekend'
)
group by c.name,p.id order by c.name,p.name;
```

Esperado inicialmente: ocho filas, 8 variantes, 1 imagen y 48 unidades por
producto. Al repetir después de cambios de stock, las cantidades pueden diferir.

Finalmente, con **solo las dos variables públicas ya configuradas**:

```bash
NODE_USE_ENV_PROXY=1 npm run verify:supabase
npm run dev
```

Verificar home, categoría, ficha, selección de talle/color y fotos firmadas reales.
Las cantidades de `verify:supabase` son filas visibles de todo el proyecto y pueden
superar las de esta demo si ya había datos. Revisar también una imagen por modelo.
No introducir claves administrativas en Vite para revisar la tienda.

## Límites de la comprobación previa

Las pruebas locales ejecutan las migraciones y el seed sobre PostgreSQL embebido,
con contratos Auth/Storage simulados. Comprueban constraints, relaciones, RLS e
idempotencia del SQL, pero **no certifican** que el esquema remoto no tenga drift,
las credenciales del futuro operador ni el servicio remoto de firma de imágenes.
La corrección del SQL no ejecuta la carga: la comprobación del servicio remoto
tras la carga del operador sigue siendo necesaria.
