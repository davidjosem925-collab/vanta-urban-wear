# Seguridad, modelo de datos y concurrencia

## Frontera de confianza

El navegador usa exclusivamente la clave publicable/anon. RLS y grants permiten
leer categorías activas, productos activos de categorías activas, variantes
activas e imágenes de esos productos. No se expone el inventario exacto. Todo lo
privado está en tablas sin grants anon: pedidos con datos personales, ítems,
pagos, eventos, envíos, reservas, inventario y perfiles administrativos.

Un usuario autenticado común tiene el mismo catálogo público y ninguna fila
privada. `is_admin()` consulta una membresía persistida, no metadata modificable
por el usuario; usa SECURITY DEFINER, search_path vacío y referencias calificadas
para evitar recursión RLS y sustitución de objetos. Solo el operador confiable o
backend autorizado puede aprovisionar membresías. Los administradores pueden
editar catálogo y Storage y leer operaciones. Las escrituras de stock, pedidos,
pagos y reservas quedan exclusivamente para futuros servicios transaccionales.
Ningún usuario de navegador, incluso administrador, puede marcar un pedido pagado
ni modificar inventario directamente.

La clave service_role omite RLS. En el futuro estará solo en backend, nunca en
frontend, logs o repositorio. Cada endpoint administrativo deberá verificar el
JWT con Auth y la membresía activa antes de usarla. Evitar logs de domicilios,
emails y payloads de pago; definir retención y eliminación/anonimización antes de
producción. No almacenar datos de tarjeta ni payloads completos del proveedor.
El UUID del pedido no es un secreto ni una credencial para consultar pedidos.

## Modelo e integridad

Todos los importes son enteros `bigint` en centavos ARS con límites. Los totales de
línea y total del pedido son generados. El backend deberá comprobar que subtotal
coincide con la suma de ítems y monto del pago con el total: una CHECK no puede
validar otras filas. Los snapshots de ítems conservan nombre, SKU, talle, color y
precio histórico; los productos/variantes con historia se desactivan, no borran.

Hay unicidad de SKU, slug, combinación producto/talle/color, posición de imagen,
clave de idempotencia de pedido/pago, identificador externo de pago y evento por
proveedor. Solo un pago puede permanecer aprobado por pedido. La reserva usa FK
compuesta para impedir asociar un ítem a otro pedido o variante. Sus cantidades
deben coincidir con el ítem en la futura transacción. Stock exige
`0 <= reserved <= on_hand`; disponible = `on_hand - reserved`. Las FKs y sus índices
permiten integridad sin borrar historia accidentalmente. No se exponen vistas
SECURITY DEFINER de datos privados.

## Contrato transaccional futuro (no implementado en esta etapa)

No habilitar checkout hasta implementar y probar estas operaciones en PostgreSQL.
No hacer una secuencia de llamadas REST independientes para simular transacciones.
Usar RPC privadas, sin EXECUTE para PUBLIC/anon/authenticated; solo service_role.
Revalidar permisos en el backend que las invoca. Mantener orden de locks consistente:
pedido primero, luego inventarios ordenados por UUID de variante.

### Crear pedido y reservar

1. El endpoint recibe datos de invitado, IDs de variante/cantidad y clave UUID de
   idempotencia. Valida esquema, cantidades, límites, email, teléfono y domicilio
   para Correo Argentino. Aplica rate limiting/antibot; no acepta precios del cliente.
2. Una única transacción inserta la clave del pedido con hash SHA-256 del request
   normalizado. Si hay conflicto concurrente, espera su resolución y devuelve el
   pedido existente solo si el hash coincide; si difiere, responde conflicto.
3. Bloquea categorías, productos y variantes elegidas para estabilizar estado y
   precios durante la transacción (coordinado con las escrituras del catálogo).
   Bloquea filas de inventario con `SELECT ... FOR UPDATE` ordenado por variante.
   Rechaza variantes duplicadas o las normaliza antes de bloquear.
4. Relee precios, disponibilidad, flags activos, descuento por transferencia y
   costo de envío desde fuentes confiables. Rechaza faltantes de inventario.
   Recalcula todo en centavos; ninguna aritmética flotante ni precio del navegador.
5. Por cada variante, incrementa `reserved` solo si
   `on_hand - reserved >= cantidad`, con UPDATE condicional y verificación de filas.
   Inserta snapshots, envío y reservas con vencimiento. Si falla cualquier ítem,
   ROLLBACK completo: no queda un pedido parcial ni stock retenido.
6. COMMIT. Reintentos por deadlock/serialización conservan la clave y tienen límite.
   La lectura de disponibilidad previa nunca garantiza stock hasta el COMMIT.

No se mantiene una transacción abierta durante una llamada a Mercado Pago. La
preferencia se crea después de reservar con una clave estable por intento. Un
fallo externo deja una reserva recuperable/vencible. El backend debe conservar
el resultado y permitir reconciliación ante timeout sin duplicar preferencias.

### Notificación, aprobación y expiración

1. Verificar firma y autenticidad del webhook, y consultar el pago al proveedor
   desde servidor. Verificar comercio, referencia, moneda y monto exactos; nunca
   confiar en redirects o status enviado por el navegador.
2. Registrar `(provider,event_id)` sin duplicados. El registro de recepción no
   significa procesado: eventos recibidos/fallidos deben poder reintentarse.
3. En una transacción, bloquear pedido `FOR UPDATE` y luego sus inventarios en el
   mismo orden que expiración/cancelación. Releer estado; si ya está pagado por ese
   pago, responder éxito sin volver a descontar. Rechazar regresiones de estado.
4. Si reservas siguen activas y válidas, decrementar `on_hand` y `reserved` por su
   cantidad, marcar reservas consumidas, pago aprobado, pedido pagado y evento
   procesado en el mismo COMMIT. Un segundo pago diferente del mismo pedido se
   registra y deriva a reconciliación/reintegro; el índice de aprobación impide
   aceptar dos liquidaciones, pero no evita que el proveedor cobre dos veces.
5. Un job de vencimiento/cancelación bloquea igualmente pedido e inventario y
   libera únicamente reservas activas de pedidos pendientes. Marca estado final
   y resta `reserved` una sola vez. Usa lotes acotados y `SKIP LOCKED` para pedidos.
   El job y el webhook se serializan por el lock del pedido.
6. Si el pago llega después del vencimiento, no consumir stock liberado: intentar
   una nueva reserva atómica si la política lo permite, o enviar a conciliación y
   reintegro. Nunca marcar pagado si no se pudo asegurar stock. Medios de efectivo
   de Mercado Pago pueden acreditarse tarde: definir plazos compatibles y probar
   este caso antes de habilitarlos.

Transferencias y efectivo al retirar requieren confirmación de un administrador
por backend y el mismo protocolo idempotente. No reservar indefinidamente;
definir plazos por método. Reembolsos no reponen stock automáticamente: devolución
física e inspección deben autorizar una operación separada auditada.

## Validación y límites

`npm test` aplica ambas migraciones en PGlite, un PostgreSQL embebido real con
contratos mínimos simulados de `auth` y `storage`. Verifica catálogo oculto,
Storage, privacidad, aislamiento de usuarios comunes, autoescalamiento, stock,
domicilio y unicidad de pagos/idempotencia. Estas pruebas no ejecutan migraciones
remotas y no equivalen al stack completo de Supabase Auth/Storage/PostgREST.

Pendiente antes de producción: ejecutar migraciones en Supabase local con CLI y
Docker, probar acceso HTTP con tokens reales, tests concurrentes multi-conexión
(última unidad, dos pagos, expiración vs webhook), pruebas de reintentos y caídas,
restricciones cross-row de totales/reservas, auditoría de operaciones de stock,
rate limiting, firma de webhook, reconciliación y tareas programadas. Esta etapa
prepara el esquema y la estrategia; no entrega reservas ni pagos operativos.
