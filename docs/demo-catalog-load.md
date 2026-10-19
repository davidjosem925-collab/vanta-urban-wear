# Carga propuesta del catálogo demo de VANTA — pendiente de aprobación

**No se ha ejecutado contra Supabase remoto.** Esta entrega prepara archivos y
pruebas locales. No hay migraciones nuevas ni cambios de políticas RLS. La PR #2
permanece sin fusionar. No ejecutar esta guía hasta aprobar la carga.

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
  reemplaza el antiguo ejemplo de cuatro productos locales.
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

## 3. Tras la aprobación: ejecutar el SQL en VANTA

En **SQL Editor del mismo proyecto** y como operador autorizado:

1. Verificar nuevamente el ref en el Dashboard. Este es el control humano del
   destino de la base; una variable de sesión no demuestra su identidad.
2. Abrir `supabase/seeds/catalog.example.sql` de esta rama y revisar su contenido.
3. En una consulta nueva, anteponer esta línea al archivo completo:

   ```sql
   SET vanta.demo_project_ref = 'evlbfjvvljbkntlozokt';
   ```

4. Pegar debajo el SQL completo, incluidos `begin;` y `commit;`, y ejecutarlo una
   sola vez. Debe devolver: **8 productos / 64 variantes / 8 imágenes / 64 filas
   de inventario**. Repetir el mismo archivo es seguro.

La confirmación de sesión es una barrera deliberada, no una autenticación del
proyecto. El seed verifica el bucket y la existencia de las ocho rutas en
`storage.objects`; el CLI anterior es quien verifica los bytes reales. Las
inserciones del catálogo y el stock se confirman en **una transacción**. Si falla
un control, no continuar con fragmentos del archivo. Ejecutar `ROLLBACK;` si la
sesión sigue abierta, revisar el conflicto y repetir el archivo completo.

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
La carga y esa comprobación real quedan pendientes de aprobación.
