# Revisión de etapa 2

## Bloque 1 — Supabase

- Cliente tipado con configuración por entorno y acceso público anónimo, sin
  persistencia/restauración de sesiones administrativas.
- Servicios de lectura para categorías, productos activos, imágenes y variantes;
  filtros de categoría/slug y paginación. No hay escrituras públicas ni lectura
  de inventario, pedidos, pagos o compradores.
- Storage privado mediante URLs firmadas de 15 minutos, renovación ante error y
  placeholder accesible. No se cambió RLS ni el bucket.
- `.env.example` incluye la URL pública indicada y deja la clave vacía.
- `npm run verify:supabase`: comprobación opcional de lectura real sin imprimir
  credenciales, registros ni URLs firmadas.

## Bloque 2 — Dark Luxury

- Rediseño de header, navegación móvil, hero editorial, categorías, tarjetas,
  manifiesto y footer, con accesibilidad y reducción de movimiento.
- Imagen original generada con IA, sin fotografías de otras marcas.
- Datos ficticios y enlaces de referencia identificados; sin números ni cuentas
  de terceros usados como contacto ficticio.

## Bloque 3 — Catálogo y validación

- Navegación por categoría y producto, galería, selector compatible de talle/color,
  precios ARS y estados de carga, reintento, vacío y no encontrado.
- Disponibilidad honesta: variante publicada y stock por confirmar. No se deduce
  stock a partir de `active`, ni se publican cantidades privadas.
- Transferencia a confirmar, sin inventar porcentajes o descuentos.
- Seed separado opcional en `supabase/seeds/catalog.example.sql`, no ejecutado.

Comprobaciones realizadas:

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Sin errores ni warnings |
| `npm test` | 29 pruebas aprobadas en 6 archivos |
| `npm run build` | TypeScript y build Vite correctos |
| `git diff --check` | Sin errores |
| Chromium, escritorio 1440×1000 | Home, catálogo, galería y selección correctos |
| Chromium, móvil 375×812 y 320×812 | Menú y navegación correctos, sin desborde horizontal |
| Errores JavaScript en navegador | 0 durante las comprobaciones |
| Escrituras del catálogo en navegador | 0; consultas de datos GET, POST solo para firmar imágenes |

Las pruebas de navegador usan respuestas HTTP simuladas en loopback, sin acceder
al proyecto real ni introducir un modo demo en producción. Los tests SQL/RLS
heredados siguen usando PostgreSQL embebido con contratos Auth/Storage simulados.

**Verificación real pendiente:** las variables privadas no estaban disponibles
en el entorno al comprobarlo. El comando opcional terminó con configuración
incompleta antes de enviar solicitudes remotas. Falta configurar ambas variables
reales en privado y ejecutar `npm run verify:supabase`. También verificar imágenes
propias asociadas a productos y navegación con datos publicados reales.

No se publicaron claves, no se modificaron migraciones, no se insertaron datos
remotos, no se ejecutó el seed ni se desplegó la tienda. No incluye carrito,
checkout, pagos ni panel. Los cambios se entregan en una nueva rama y PR, sin
fusión automática ni cambios en Burger House u otros repositorios.

## Preparación del catálogo demo para revisión

Se reemplazó el seed local mínimo por una propuesta revisable de ocho productos
(dos por categoría), 64 variantes, 64 filas de inventario y ocho fotografías
originales generadas con IA. Herramientas locales y carga explícita de Storage,
con controles de proyecto, integridad, conflictos e idempotencia.

Se ejecutan pruebas adicionales sobre las migraciones actuales en PostgreSQL
embebido y sobre Storage simulado: repetición sin duplicados, preservación del
stock/reservas y datos ajenos, rollback ante conflictos, requisitos previos, RLS,
fotos diferentes y reanudación de cargas parciales.

**No se ejecutó el seed ni la carga de imágenes contra Supabase remoto.**
No se cambiaron migraciones, RLS ni código del frontend. Ver
[demo-catalog-load.md](demo-catalog-load.md) para archivos, comandos exactos y
verificación posterior a la aprobación. La verificación pendiente descrita más
arriba corresponde al registro histórico de la primera entrega.

## Corrección permanente para SQL Editor (42P01)

El generador reemplaza las tablas temporales `ON COMMIT DROP` por datos JSONB
locales a una única sentencia DO atómica. El resumen posterior solo consulta
tablas permanentes e IDs inline. La confirmación explícita se incluye en una copia
generada en `work/`, sin `SET` de sesión ni ediciones manuales del seed.

Regresiones: reproducción de 42P01 al confirmar prematuramente la creación
temporal, contraste con transacción completa, ejecución del nuevo bloque aislado
y resumen tras `DISCARD ALL`, repetición, coincidencia de las ocho rutas
`vanta-demo-v1/<modelo>/front.png`, rechazo de rutas antiguas y generación de la
copia confirmada. No se inspeccionó ni ejecutó el seed remoto; no se cambiaron
políticas, fotos, JSON del catálogo ni productos. Procedimiento y límites del
diagnóstico en [demo-catalog-load.md](demo-catalog-load.md).

## Ampliación preparada de ocho a doce modelos

El operador confirmó la carga de los ocho modelos iniciales. Esta entrega agrega
una fuente v2 separada con cuatro prendas claras (hueso, gris melange, beige piedra
y gris claro), cuatro originales generados con IA y una plantilla incremental.
Los originales v1 conservan su fuente, fotografías, hashes, UUID y SKU.

El ámbito `extension` del generador y el uploader selecciona solo 4/32/4/32; el SQL
comprueba por lectura la base 8/64/8/64 y reporta totales 12/96/12/96. Se mantienen
el bloque DO atómico, la confirmación de proyecto, el rechazo de colisiones y la
compatibilidad Windows/Linux. La repetición no repone stock ni toca pedidos, pagos
o reservas. El ámbito completo `all` prepara doce modelos para una base vacía.

La ficha ordena siempre los talles S, M, L y XL sin alterar las combinaciones ni
los estilos existentes. Navegación, breadcrumbs, hero y categorías no se rediseñan.
Las pruebas incluyen huella exacta del manifiesto original, conservación de datos
y fotos v1, idempotencia, stock/reservas, dependencias faltantes, conflictos, RLS y
selección de colores claros. No se ejecutó SQL ni se subieron fotos a Supabase
remoto. Pasos PowerShell y verificaciones pendientes en
[demo-catalog-extension.md](demo-catalog-extension.md).

Validación de esta ampliación: `npm run check` aprobado (ESLint sin errores,
TypeScript/build correctos, **105 pruebas en 11 archivos**), `git diff --check`
correcto y `demo:check`/dry run de `demo:upload -- --scope=extension` aprobados.
Chromium local con datos e imágenes de los doce modelos: 1440×1000, 820×1000,
375×812 y 320×812, tres tarjetas por categoría, cuatro fichas claras, talles
S/M/L/XL, ambos colores, breadcrumbs, menú y regreso a Inicio; cero errores de
página, cero desbordes y cero solicitudes remotas. Las fotos se sirvieron solo en
loopback, no desde Supabase: la revisión real posterior sigue pendiente.
