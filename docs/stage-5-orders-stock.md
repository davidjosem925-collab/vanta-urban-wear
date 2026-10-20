# Etapa 5 — Pedidos demo y reservas de stock

## Estado y revisión necesaria

Código preparado para revisión; **no se aplicaron migraciones, tareas programadas,
secretos ni Edge Functions al proyecto remoto**. Tampoco se modificaron catálogo,
imágenes, precios, stock ni RLS remotos. La bandera pública permanece apagada por
defecto. La expiración automática **no está configurada ni verificada en Supabase**.
No hay pagos, emails, WhatsApp, panel administrativo ni operaciones comerciales.

## Inspección previa y reutilización

Se revisaron las dos migraciones originales, servicios de catálogo, CartProvider,
checkout, políticas, pruebas PGlite y CI antes de implementar. El esquema inicial
ya incluía `orders`, `order_items`, `inventory`, `stock_reservations`, `payments` y
`shipments`. No se crean tablas paralelas de pedidos/stock/reservas.

- `products.price_cents` es bigint ARS; publicación requiere categoría, producto y
  variante activos. `product_variants` tiene FK de producto, talle/color/SKU.
- `inventory(variant_id,on_hand,reserved)` ya impone `0 <= reserved <= on_hand`.
- `stock_reservations` ya vincula artículo, pedido y variante mediante FK compuesta.
- `orders` ya tiene UUID de idempotencia, hash del request y total generado; sus
  contactos originales son obligatorios, por eso la demo escribe placeholders
  fijos, **nunca los datos escritos por el visitante**.
- Las políticas iniciales ocultan operaciones a anónimos y usuarios no admin.
  Se conservan; únicamente se agregan políticas para las tablas nuevas de auditoría.
- Las tablas de pagos/envíos comerciales no se usan: no se crean pagos ni tarifas.

La nueva migración `202610200001_demo_orders.sql` agrega campos de demo a `orders`
(referencia pública UUID aleatoria única, hash de capacidad, entrega, método
simulado, vencimiento y resolución), producto/descripcion a snapshots de ítems,
`inventory_movements`, `demo_request_limits` y tombstones mínimos de idempotencia.
Las filas previas quedan `is_demo=false`, sin conversión ni limpieza. Los estados
comerciales previos siguen admitidos para esas filas; una CHECK impide usarlos en
pedidos demo. La migración es transaccional y **se aplica una sola vez**, mediante
el historial habitual de migraciones, no pegándola repetidamente.

## Arquitectura y frontera de confianza

Navegador → `demo-orders` Edge Function → RPC service-only → una transacción PostgreSQL.
El navegador usa solamente la clave pública existente y una site key pública de
Turnstile. El secreto antiabuso y `SUPABASE_SERVICE_ROLE_KEY` existen solo en Edge.
`src/` nunca importa archivos del backend. No hay endpoint público de lectura ni
búsqueda por referencia, ni una referencia en URL que funcione como autorización.

El endpoint exige Origin exacto, POST JSON, cuerpo máximo 8192 bytes leído de
forma acotada, listas/cantidades/precios esperados tipados y sin campos extra.
La operación recibe IDs de variante, cantidades, precios esperados, entrega y
método demo. **No recibe ni persiste nombre, apellido, email, teléfono, provincia,
localidad, domicilio o instrucciones del formulario**. La información sirve solo
para demostrar el formulario y se pierde al recargar, como en la etapa anterior.
El futuro admin verá comprador `Visitante Demo` y modalidades, no personas reales.
No se necesita enviar PII para demostrar preparación/gestión de estos pedidos.

Una capacidad aleatoria de 256 bits, distinta de la referencia pública y de la
clave UUID de idempotencia, autoriza recuperar/cancelar un intento propio. SQL
almacena su SHA-256, no el secreto. La referencia por sí sola no autoriza nada.
Los resultados contienen únicamente referencia, estado, subtotal, creación,
vencimiento e indicador demo. Errores de SQL/proveedor se reducen a códigos
conocidos; no hay logs de payloads ni respuestas privadas. CORS no sustituye la
verificación antiabuso: clientes fuera del navegador pueden falsificar Origin.

## Transacción, bloqueo y stock

Disponible = **`on_hand - reserved`**. Crear NO resta `on_hand`: solo aumenta
`reserved`. Todos los límites, publicación, precios, snapshots, contadores,
reservas y movimientos se validan/escriben dentro de `demo_create_order`.

1. Validación estricta en SQL además de Edge: 1–12 variantes distintas, 1–3 unidades
   por variante, máximo 12 unidades, IDs válidos, centavos enteros y campos exactos.
   Artículos duplicados se rechazan, no se suman silenciosamente.
2. Lock transaccional global de admisión para la escala del portfolio: serializa
   creaciones y hace atómicos los límites de reservas activas e idempotencia.
   Es una decisión conservadora de capacidad, no pensada para comercio de alto volumen.
3. Reintento: se comprueban clave, capacidad y hash SHA-256 calculado dentro de SQL.
   JSONB normaliza claves de objetos; el cliente ordena artículos por variante.
   Un cuerpo distinto o capacidad diferente con la misma clave produce conflicto.
4. Se bloquean variantes, luego sus productos y luego sus categorías `FOR SHARE`,
   por UUID dentro de cada nivel; después inventarios `FOR UPDATE` por UUID.
   Derivar cada padre desde el hijo ya bloqueado protege las reasignaciones
   concurrentes de variante/producto, publicación, precios y snapshots.
5. Se leen precios actuales de `products`; el precio esperado del cliente **solo
   detecta cambios**. Cualquier diferencia rechaza el pedido, nunca se adopta el
   importe enviado por React. El subtotal se suma en bigint, sin flotantes.
6. Se comprueba TODA la selección; luego pedido, ítems con snapshots, reservas y
   movimientos se insertan en la misma transacción. UPDATE condicional de stock
   y restricciones son defensas adicionales. Un error revierte todo.
7. Creación y vencimiento usan una misma hora del servidor, con intervalo exacto
   `60 minutes`. La hora del navegador no interviene.

El lock del pedido serializa cancelación, consumo y expiración. Cada operación
vuelve a leer el estado bloqueado, bloquea inventarios por UUID y procesa solo
reservas `active`. `inventory_movements` tiene unicidad por operación y otro índice
único para **un solo movimiento terminal por pedido/variante**. Repetir liberación
no resta dos veces `reserved`, y cancelar después de consumir nunca repone stock.
No se reservan existencias parcialmente ni se descuentan dos veces.

## Estados y autorización

| Transición | Inventario | Quién puede ejecutarla |
|---|---|---|
| nuevo → pending | aumenta reserved; plazo 60m | Edge protegido |
| pending → expired | reduce reserved, conserva on_hand | job propietario DB; también al intentar resolver después del plazo |
| pending → cancelled | reduce reserved, conserva on_hand | capacidad propia vía Edge o admin activo |
| pending → confirmed | reduce reserved **y** on_hand, marca consumed | admin activo mediante RPC |
| confirmed → preparing → delivered | sin movimiento adicional | admin activo mediante RPC |

Si el plazo venció antes de obtener todos los locks de pedido e inventario, gana
`expired`: la hora se vuelve a comprobar después de esperar inventario.
Confirmar consume definitivamente la reserva: cambiar de estado no prolonga una
reserva temporal. Después de `confirmed` no hay cancelación/reintegro automático.
Esa política y cualquier devolución física quedan para etapa 6. Los RPC admin
están preparados y probados, pero no se crea panel ni endpoint admin.
`demo_admin_adjust_inventory` exige admin activo, delta entero ±1000, motivo
breve y clave idempotente; bloquea inventario, impide bajar existencias por debajo
de lo reservado y audita actor/delta/motivo. No se ejecuta ningún ajuste remoto.
Los movimientos `adjust` no pertenecen a un pedido y no se borran con su retención;
no incluir PII en los motivos. No hay resets automáticos de stock.

Las funciones SECURITY DEFINER fijan `search_path=''`, califican tablas y revocan
EXECUTE de PUBLIC/anon/authenticated por defecto. Solo las RPC estrechas de Edge
se conceden a service_role; `demo_admin_transition` se concede a authenticated
pero **exige `is_admin()`**. El núcleo de resolución no es ejecutable por visitantes
ni service_role. Expiración/limpieza solo las ejecuta el propietario DB/cron.
Se revocan todos los privilegios de service_role sobre pedidos/ítems/stock/reservas
y se restituye únicamente SELECT; también se eliminan TRIGGER y REFERENCES. Una
comprobación de privilegios efectivos de anon/authenticated/service_role hace
fallar la migración si quedan escrituras heredadas. Las RPC usan al propietario
confiable de las funciones, no los permisos DML del invocador.
La clave sigue siendo privilegiada para otros recursos: nunca se distribuye.

## Idempotencia y recuperación

El doble clic se bloquea en React, pero la garantía está en SQL. Los reintentos
concurrentes reciben el mismo resultado y no reservan otra vez. El endpoint busca
un resultado previo autorizado **antes** de consumir otro token de Turnstile.

`sessionStorage` guarda únicamente clave/capacidad, IDs/cantidades/precios
esperados y modalidad/método de un intento pendiente. No guarda contacto ni
URLs firmadas. Permite recuperar tras recargar; una respuesta ambigua conserva
el intento original aunque se cambie después el carrito. Datos corruptos o
almacenamiento no disponible bloquean la confirmación con mensaje, no generan
silenciosamente una nueva clave. Una respuesta inválida no es éxito.

Tras confirmación válida se elimina el intento y solo se retiran del carrito las
cantidades confirmadas; adiciones nuevas durante la petición se conservan. Errores
stock/precio/publicación dejan el carrito intacto y habilitan una nueva revisión.
Errores de red conservan el intento. Una respuesta expired/cancelled se informa
sin vaciar el carrito. El botón «Consultar confirmación pendiente» permite recuperar incluso con carrito vacío o variantes ya no disponibles. El recibo vive en memoria, no en una ruta pública de pedidos.

Después de retención, tombstones mínimos (clave UUID + hashes de capacidad/request)
impiden recrear un pedido usando su clave antigua. No contienen contacto, referencias
ni artículos y se conservan mientras exista esta instalación de demo. La capacidad
no permite recuperar un pedido cuya información ya se limpió.

## Protección contra abuso

- Turnstile es obligatorio para **crear**: verificación server-side, `success=true`,
  hostname esperado y action `demo-order`, con timeout y cierre seguro al fallar.
  El widget compacto (150px de ancho) evita el mínimo de 300px de los modos normal/flexible y solo carga en revisión cuando se habilita la etapa. Tokens de uso único
  y expiración los valida el proveedor. Recuperar un intento propio no necesita
  reutilizar el token consumido.
- Límite SQL durable: 6 peticiones/hora por bucket de solicitante y 60 creaciones/hora globales.
  El presupuesto global solo se consume después de validar Turnstile, para que
  solicitudes sin challenge válido no lo agoten. Ambos usan transacciones separadas que no se revierte si falla la creación. Incluye cancelaciones
  y reintentos, por lo que excederlo puede requerir esperar. Error 429 explícito.
- El bucket usa hash de secreto server-side + último hop de X-Forwarded-For; solo
  se almacena el hash. **Verificar manualmente** que el gateway de despliegue
  sobrescribe/agrega ese header antes de considerarlo identidad de red confiable.
  No se usa para autorización; aun si se falsifica, subsisten Turnstile, el límite
  global y los límites SQL de reservas. No prometer inmunidad contra botnets.
- Máximo 20 pedidos pending globales, 80 unidades reservadas demo globales y 2
  pedidos pending por capacidad, comprobados atómicamente. Rotar capacidad no
  evita el límite global. No se acepta el reloj del cliente ni contadores React.
- La función cancela solo con capacidad propia. No hay lookup/listado anónimo.
  No se expone stock exacto ni se devuelven errores internos.

Estos límites son deliberadamente bajos para portfolio, no garantías de disponibilidad
comercial. El operador puede apagar la bandera/deshabilitar Edge si hay abuso;
las reservas existentes siguen venciendo mediante el job. No incrementar límites
ni crear secretos automáticamente.

## Expiración y retención

`demo_expire_orders()` procesa hasta 100 pedidos vencidos por lote con locks y
`SKIP LOCKED`, independiente del navegador. El script opcional prepara pg_cron
cada minuto. La **validez** termina exactamente a creación +60m; la liberación
material ocurre al primer tick disponible posterior (habitualmente <60s), puede
demorarse si el job falla. Nunca se admite una confirmación pasada la fecha.
No se afirma precisión de scheduler al segundo ni que cron remoto ya funcione.

`demo_cleanup()` expira primero y limpia hasta 100 pedidos demo terminales
cancelled/expired/delivered con más de 30 días, solo si no tienen reservas activas,
pagos ni envíos asociados; conserva tombstone. Borra auditoría/reservas/ítems de
esos pedidos en orden FK. No toca pedidos ajenos, catálogo, stock físico o imágenes.
Pedidos confirmed/preparing esperan resolución administrativa y no tienen reservas
activas. Buckets antiabuso inactivos se limpian después de 2 días.

## Despliegue manual — requiere aprobación

### 1. Inspección y respaldo

Mantener `VITE_DEMO_ORDERS_ENABLED=false`. Revisar esta PR, migración y permisos;
respaldar esquema/datos y verificar el proyecto **evlbfjvvljbkntlozokt** en Dashboard.
Ejecutar manualmente `supabase/operations/stage-5-preflight.sql`, que es de solo
lectura. Revisar migraciones aplicadas, columnas, constraints/RLS, inventario y
extensiones disponibles. Localmente se inspeccionaron herramientas: Docker y
PostgreSQL temporal disponibles; Supabase CLI/Deno no preinstalados. No se inspeccionó
ni habilitó pg_cron remoto con credenciales administrativas.

### 2. Migración

Después de aprobación, aplicar **solo**
`supabase/migrations/202610200001_demo_orders.sql` con el mecanismo de migraciones
del proyecto, o en SQL Editor ejecutando el archivo completo BEGIN…COMMIT una vez.
Registrar esa aplicación si luego se usa CLI para no reaplicarla. No ejecutar seeds,
no recrear tablas anteriores y no usar `db reset` contra remoto. Si hay diferencias
con el esquema inspeccionado, detenerse y revisar; no forzar la migración.

### 3. Turnstile y Edge

Crear manualmente un widget Turnstile para los hostnames aprobados (y localhost
solo para pruebas), anotar site key pública. Aprobar uso de este proveedor y sus
implicaciones de privacidad (el proveedor recibe datos técnicos del navegador;
no se le envía contacto/domicilio). Guardar mediante Dashboard → Edge Functions →
Secrets, **sin prefijo VITE**:

- `DEMO_ALLOWED_ORIGIN`: origen exacto, por ejemplo `https://tu-dominio.example`,
  sin path ni barra final. Un origen por despliegue.
- `DEMO_CHALLENGE_HOSTNAME`: hostname exacto de ese widget, sin protocolo/puerto.
- `TURNSTILE_SECRET_KEY`: secreto del widget aprobado.
- `DEMO_ACTOR_SECRET`: secreto aleatorio de al menos 32 caracteres generado por
  el operador. No reutilizarlo como clave del frontend.
- `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`: bindings server-side provistos por
  Supabase en Edge. Nunca copiarlos al frontend, logs, PR ni variables públicas.

Desde una CLI Supabase instalada y autenticada para el proyecto correcto:

```bash
supabase functions deploy demo-orders --project-ref evlbfjvvljbkntlozokt --no-verify-jwt
```

Esto es un endpoint de invitado: no depende de una sesión de usuario ni del JWT
legacy. `supabase/config.toml` limita `verify_jwt=false` a esta función. Seguridad
real = validación, Turnstile, capacidad y límites; la clave pública no autentica
compradores. No desplegar hasta revisar todo el handler y probar RLS/RPC por HTTP
en Supabase local o un proyecto de pruebas. Si el sitio tiene CSP, permitir únicamente
el script/frame y conexión necesarios a `https://challenges.cloudflare.com`; no
ampliar CSP a comodines. No se cambia CSP automáticamente en esta PR.

### 4. Cron y verificación

Confirmar `pg_cron` disponible/instalado con preflight. Si es necesario, habilitarlo
manualmente en Dashboard → Database → Extensions, **tras aprobación**. Revisar y
ejecutar `supabase/operations/stage-5-schedule.sql` como propietario. Los nombres
`vanta-demo-expiry` y `vanta-demo-retention` permiten reprogramar sin duplicar jobs.
No hay claves de servicio en comandos cron ni HTTP externo.

Revisar `cron.job` y `cron.job_run_details`. Ejecutar
`supabase/operations/stage-5-verify.sql`; probar en staging reserva, cancelación,
reintento y una expiración real de 60m. Si pg_cron no está disponible, **no habilitar
pedidos** hasta aprobar un scheduler confiable equivalente; no usar visitas a la
página como mecanismo de expiración. No cambiar clocks/fechas de producción para
simular el paso del tiempo.

### 5. Habilitar frontend al final

Solo con SQL, Edge, origen, challenge y job verificados, configurar y reconstruir:

```dotenv
VITE_DEMO_ORDERS_ENABLED=true
VITE_TURNSTILE_SITE_KEY=site_key_publica_aprobada
```

Conservar las dos variables públicas existentes de Supabase. La bandera apagada
mantiene el recorrido anterior «Finalizar demostración», sin falsas referencias,
sin escrituras, sin reservas y sin cargar Turnstile. Encenderla con un backend
faltante muestra error, conserva carrito y nunca inventa éxito.

### Recuperación

Apagar bandera y reconstruir frontend; si es necesario deshabilitar la función
Edge, pero **mantener job de expiración activo** hasta liberar reservas pending.
Si cron falla, el operador autorizado puede ejecutar `select public.demo_expire_orders();`
repetidamente y corregir el scheduler, revisando métricas agregadas. No editar
contadores a mano ni borrar pedidos pending. La migración es aditiva salvo ampliar
CHECK de estados/restringir grants: no quitar columnas/tablas con pedidos activos.
Guardar historial; preparar una migración correctiva revisada si hay drift. No
revertir indiscriminadamente permisos. Una confirmación cuyo resultado se perdió
se recupera con la misma clave/capacidad; no crear otra clave para “arreglar” timeout.

## Pruebas y uso local

```bash
npm ci
npm run check
npm run test:e2e
npm run test:e2e:orders
npm audit
```

`check` incluye ESLint, TypeScript de Edge (contrato mínimo Deno), Vitest/PGlite y
TypeScript frontend/build. Handler Edge probado con Request/Response y dependencias
inyectadas, sin red. La prueba SQL aplica migraciones reales en PGlite con contratos
mínimos de auth/storage, no un mock de la transacción.

Con Docker local, sin DSN remoto ni puertos publicados:

```bash
docker run -d --name vanta-stage5-pg -e POSTGRES_PASSWORD=local-test-only --tmpfs /var/lib/postgresql/data postgres:17-alpine
# Esperar pg_isready; crea/borra únicamente la DB dedicada vanta_stage5_test.
VANTA_TEST_PG_CONTAINER=vanta-stage5-pg npm run test:orders:postgres
# PowerShell: $env:VANTA_TEST_PG_CONTAINER='vanta-stage5-pg'; npm run test:orders:postgres
# Al terminar: docker rm -f vanta-stage5-pg
```

El script fija el socket Docker local en Linux/CI, nunca acepta URL de producción.
En Windows usar Docker Desktop desde WSL para este test multiconexión (el resto
usa Node normal); no requiere acceso a Supabase. CI incluye PostgreSQL 17 real.
Para revisar visualmente modo compatible: `npm run dev` con bandera false y abrir
http://localhost:5173. Para revisar toda la interfaz con respuestas aisladas, usar
`npm run test:e2e:orders -- --headed --project=mobile-393` y sus capturas en `work/`.
Las respuestas de navegador son fixtures, **no prueba de persistencia remota**.

Cobertura nueva: atomicidad, snapshots/precios del servidor, estados/publicación,
variantes desconocidas/duplicadas, cantidades/JSON inválido, idempotencia/hash/
capacidad, cancelación/vencimiento repetidos, consumo/transiciones autorizadas,
retención, RLS y mínimos EXECUTE, límite durable, challenge/origen/body, errores
red y recuperación, carga, ausencia de éxito prematuro, privacidad, navegación
mientras llega una respuesta y preservación de nuevas unidades. PostgreSQL real
prueba última unidad, reintentos concurrentes, cancelación vs expiración y permisos.
Playwright conserva regresiones anteriores y añade el modo configurado a 320,
375,393,820,1440px, con capturas y control de desbordes.

Pendiente de infraestructura, expresamente **no ejecutado**: despliegue Supabase,
Auth/PostgREST/gateway reales con tokens, widget y secreto Turnstile reales,
scheduler pg_cron y expiración de 60 minutos en staging. Estas verificaciones son
requisito antes de habilitar la bandera en el sitio público. Etapa 6: panel admin,
gestión de estados y ajustes mediante los RPC preparados; política y autorización de devoluciones; no se implementa aquí.


### Resultado de la validación de esta PR

Los resultados finales y el enlace a CI se consignan en la descripción de la PR.
El build conserva una advertencia de tamaño del bundle principal (~504 kB,
~148 kB gzip); no es un error de TypeScript, no se elevó el umbral para ocultarla.
La separación adicional de bundles queda como mejora de rendimiento independiente.
La guía de revisión incluye las capturas de recibo en los cinco anchos.


La [auditoría técnica final y guía verificable de despliegue](stage-5-final-audit.md)
incorpora las comprobaciones reales aportadas por el operador y las correcciones
de concurrencia y privilegios realizadas antes de aprobar la migración.
