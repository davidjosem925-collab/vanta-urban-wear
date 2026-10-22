# Etapa 8, fase 2 — backend de pagos de prueba

Implementación local revisable, apagada por defecto. **No desplegada ni aplicada
al Supabase alojado; no se usaron credenciales ni servicios reales de Mercado
Pago.** La fase no incluye interfaz, envío de correos ni nuevos datos personales.
El diagnóstico original está en [stage-8-payments-email-design.md](stage-8-payments-email-design.md).

## Contrato y recorrido

Se reutiliza `demo-orders` sin modificarlo: crea el pedido/reserva mediante
Turnstile, límites e idempotencia y devuelve referencia/capacidad del intento.
El nuevo backend recibe **ese pedido ya creado**, no otro carrito ni otro total.
Esto conserva las validaciones de precios, publicación, inventario y capacidad
de la etapa 5; no introduce otra forma pública de reservar stock.

| Función | Autorización y contrato |
| --- | --- |
| `mp-checkout` | POST JSON desde `MP_ALLOWED_ORIGIN`, capacidad del pedido y límite de etapa 5. Cuerpo exacto: `action` (`create` o `recover`), `reference` y `capability`. No admite precios, total, medio de pago, email, URL ni estado del cliente |
| `mp-webhook` | POST JSON externo sin Origin/JWT de cliente. Firma oficial HMAC, `data.id` y `type=order` en query; body de tópico `order`, entorno no live, aplicación/vendedor correctos. Después consulta el recurso en la API antes de conciliar |
| `mp-reconcile` | POST `{}` con `Authorization: Bearer <secreto privado del worker>`. No acepta una sesión administrativa, clave pública ni capacidad de comprador como autorización |

`verify_jwt=false` en estas tres funciones es deliberado: las protecciones están
implementadas en cada handler. No expone RPC al navegador: los permisos de la
base son otra frontera independiente. No se debe publicar un worker sin su
secreto. Los límites y el challenge existentes para crear pedidos permanecen.
Las llamadas de checkout comparten el bucket de seis solicitudes/hora por actor
con etapa 5; el frontend de fase 3 deberá evitar polling público repetitivo.

`create` prepara una fila `payments` por pedido, desde snapshots SQL. Persiste
cuerpo, UUID de idempotencia y URLs de retorno inmutables; toma una lease corta y
crea la order de Checkout Pro vía `POST /v1/orders`. Todos los reintentos de esa
operación reutilizan clave y cuerpo. No crea otra reserva. Cambiar el catálogo o
el origen configurado no cambia un cuerpo ya emitido al proveedor.

`recover` nunca prepara ni crea un pago ausente. Si el recurso ya está vinculado,
consulta su estado en Mercado Pago y concilia. La respuesta pública contiene
referencia, estados separados, monto en centavos ARS, vencimiento y URL de checkout
cuando aún es utilizable. No devuelve identificadores internos, claves, requests,
capacidades ni datos personales. `202` indica que la creación tiene una operación
en curso/sin URL; `found:false` indica ausencia de pago, no aprobación ni permiso
para duplicar el pedido.

Los errores son códigos públicos cerrados: `DISABLED`, `NOT_CONFIGURED`,
`ORDER_UNAVAILABLE`, `RATE_LIMITED`, `PROVIDER_HTTP`, `PROVIDER_UNAVAILABLE`,
`INVALID_PROVIDER_RESPONSE`, `TEST_IDENTITY_REQUIRED`, `RPC_UNAVAILABLE`, etc.
Las futuras pantallas traducirán esos códigos; no hay texto crudo del proveedor.
Los diagnósticos contienen operación, código, HTTP y, cuando corresponda,
dependencia/HTTP upstream. No contienen URLs completas, cuerpos, tokens, firmas,
claves de idempotencia, capacidades, IP, nombres o datos de tarjeta.

## Bloqueo productivo y compatibilidad real

La referencia oficial de **Orders API** documenta `invalid_credentials` para
credenciales de prueba clásicas, y recomienda usuarios de prueba con sus propias
credenciales. Estas pueden empezar con `APP_USR-`. **No utilizar credenciales de
una cuenta vendedora real ni interpretar ese prefijo como prueba suficiente.**

La implementación:

1. Solo acepta `MP_MODE=test`. No existe rama productiva ni flag para permitirla.
2. Antes de cualquier escritura al proveedor consulta el endpoint autenticado
   oficial `https://api.mercadolibre.com/users/me` con el mismo token: exige ID de
   vendedor esperado, `tags` con `test_user`, `site_id=MLA`, `country_id=AR` y cuenta
   activa. Si falla, está bloqueado o no devuelve evidencia suficiente, **no hay
   POST de pago**. No se utiliza una declaración del navegador ni un token prefijado
   como único control. La compatibilidad de este endpoint con el token concreto
   de la aplicación debe comprobarse manualmente; un 403 no autoriza a omitirlo.
3. Solo vincula recursos `ORDTST…`; verifica ID, tipo online/manual, vendedor,
   aplicación, Argentina, ARS, referencia, monto completo, líneas y cantidades
   exactas contra el snapshot SQL. Rechaza `live_mode=true` cuando está presente.
4. Solo devuelve checkout HTTPS del dominio argentino y formato esperado; HTTP
   a terceros no sigue redirecciones. Las URLs de API son constantes del código,
   nunca valores recibidos en webhooks. Las respuestas tienen timeout y límite
   de bytes antes de parsear JSON.

La comprobación de identidad es adicional al modo/ID de prueba. Si la respuesta
real del sandbox no satisface ese contrato, la integración permanecerá cerrada
hasta investigar la diferencia; no se agrega un bypass productivo por comodidad.
No se capturan tarjetas ni se implementa captura, reembolsos o pagos reales.

## Firma, eventos y conciliación

La firma sigue el SDK oficial **mercadopago 3.6.1**: manifiesto
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, preservando el caso del ID recibido.
Se contrastó localmente con el verificador oficial publicado. Para Orders, no se
aplica automáticamente la normalización a minúsculas de ejemplos antiguos de
otras notificaciones. Hay prueba independiente Node HMAC → verificación WebCrypto.
La comparación HMAC y la del secreto del worker utilizan primitivas WebCrypto.
Se admiten timestamps en segundos o milisegundos; se rechazan fechas futuras
inverosímiles. Los reintentos firmados antiguos no se descartan solo por edad:
deduplicación y consulta del estado actual impiden reaplicar un estado anterior.

El webhook persiste únicamente ID de recurso y hash del manifiesto autenticado
en `payment_events`; no guarda el body ni campos de tarjeta. Una lease evita
trabajo duplicado. HTTP 200 solo después de persistencia durable; si API/SQL
fallan, queda trabajo recuperable y se devuelve error reintentable. La firma no
se usa como prueba de pago: el estado se obtiene siempre con GET al proveedor.
Los body de webhook con `live_mode`, vendedor/aplicación o ID incoherentes se
rechazan antes de consultar la API.

El worker toma como máximo dos eventos y dos pagos por ejecución, con leases,
`SKIP LOCKED`, tiempos acotados y siguiente revisión persistida. Puede buscar una
creación cuyo response/binding se perdió por referencia y rango de fechas
(`GET /v1/orders?begin_date=…&end_date=…&external_reference=…&limit=2`), y luego
verificar el recurso con GET individual. No basta un resultado de búsqueda para
aprobar. Más de un resultado exige revisión, no elección arbitraria.

Los POST de creación tienen un máximo de ocho intentos, siempre con la misma
clave/cuerpo; después solo se busca/consulta. El worker sigue reconciliando sin
crear pagos cuando `MP_CHECKOUT_ENABLED`/SQL están apagados. Si no hay recurso y
venció el pedido, marca vencimiento local sin emitir otro POST. Los eventos tienen
un máximo de veinte intentos y los pagos una ventana de conciliación automática
de treinta días. Los agotados requieren revisión del propietario; no se borran.
Los intervalos actuales son de uno/cinco minutos y una hora para estados terminales
/revisión. No se promete una entrega exactamente una vez de redes externas.

Una nueva order MP por cada rechazo **no** se genera automáticamente: se conserva
el recurso/clave existente. Reintentos dentro del checkout dependen de los medios
y posibilidades que habilite el proveedor. Reiniciar una compra cerrada no deberá
reutilizar ni reabrir una reserva vencida.

## Estados y garantías de inventario

`orders.status` continúa siendo logístico; `payments.status` guarda estado local
de pago. `mp_provider_status/detail`, timestamp e indicador de conciliación son
metadatos acotados, no cuerpos completos del proveedor.

| Pago verificado | Resultado |
| --- | --- |
| Creado, procesándose o esperando captura | Pendiente; no aprobado ni consumo |
| `processed/accredited`, monto completo | Aprobado; confirma/consume exactamente una vez si la reserva sigue vigente |
| Rechazado | Registra rechazo; mantiene pedido pendiente y reserva hasta su plazo |
| Cancelado | Cancela/libera una vez si el pedido sigue pendiente |
| Vencido localmente | Pedido `expired`, stock liberado; no se reabre |
| Acreditado después de cancelación/vencimiento | Pago aprobado de prueba + `review`; pedido cerrado e inventario intactos |
| Reembolso parcial, desconocido o reembolsado | Revisión; sin reposición automática ni aprobación comercial |

La transacción toma primero el pedido, luego el pago y usa la primitiva existente
de resolución. Esa primitiva vuelve a comprobar el plazo **después** de esperar
por inventario. Eventos viejos no deshacen una aprobación; el reembolso observado
no regresa a aprobado por una notificación antigua. No hay transacciones SQL
abiertas mientras se realizan solicitudes HTTP.

La reserva continúa durando 60 minutos desde el pedido. La order MP solicita
`expiration_time=PT1H`; como se crea después de reservar, su vencimiento puede
ser posterior por la latencia. **El deadline SQL sigue mandando.** El worker intenta
cancelar operaciones pendientes cuando el pedido vence/cancela y vuelve a
consultar el recurso para resolver carreras. Una cancelación HTTP fallida jamás
se interpreta por sí sola como éxito. La granularidad/vigencia admitida por la
cuenta real de prueba aún requiere validación manual.

Un trigger bloquea las transiciones administrativas normales de nuevos pedidos
vinculados a MP si no existe pago aprobado y conciliado. Conserva las transiciones
y métodos de pedidos anteriores sin MP, la consulta administrativa y Auth.
Transferencia continúa en su modo demo anterior: no hay cambios de interfaz ni
confirmación bancaria nueva en fase 2.

## Migración y permisos

Archivo incremental: `supabase/migrations/202610230001_mp_test_backend.sql`.
No actualiza filas históricas, no modifica `is_admin()`, `admin_membership()`,
Auth, inventario, cron, productos, precios ni RLS existentes.

- Agrega metadatos de sandbox a `payments/payment_events`, índices y constraints.
  La CHECK de pagos incorpora `expired` conservando estados anteriores; no se
  cambia la CHECK de pedidos ni el índice de un pago aprobado por pedido.
- Nueva `mp_test_config`: privada, RLS activada, sin acceso de API; inicia apagada.
  Guarda IDs esperados y un snapshot de grants para reversión, nunca tokens.
- Revoca permisos directos de escritura/trigger/references heredados de
  `service_role` en pagos/eventos y mantiene SELECT. Las nuevas RPC estrechas son
  service-only, `SECURITY DEFINER`, search_path vacío y EXECUTE denegado a
  PUBLIC/anon/authenticated. Helpers internos no son API-callables ni por service.
- La membresía/permisos administrativos se siguen comprobando por las funciones
  existentes. Un JWT de administrador (Magic Link/contraseña o AAL2) no puede
  ejecutar las RPC backend de pagos.

## Secretos y activación manual (NO ejecutados)

1. Verificar proyecto seleccionado, backup y precondiciones con
   `supabase/operations/stage-8-preflight.sql`. No reaplicar migraciones anteriores
   ni ejecutar `supabase db push` indiscriminadamente. Revisar el SQL nuevo y, tras
   aprobación expresa, aplicar solo esa migración con el historial habitual.
2. En **Supabase → Edge Functions → Secrets**, configurar privadamente:

   | Variable | Uso |
   | --- | --- |
   | `MP_MODE` | `test`, único valor admitido |
   | `MP_CHECKOUT_ENABLED` | `false` durante configuración; `true` solo tras aprobación |
   | `MP_ACCESS_TOKEN` | Credencial privada del vendedor de prueba, nunca la del vendedor productivo |
   | `MP_TEST_SELLER_ID` | ID numérico del vendedor de prueba que devolverá el endpoint autenticado |
   | `MP_APPLICATION_ID` | ID numérico de la aplicación Checkout Pro / Orders API |
   | `MP_WEBHOOK_SECRET` | Secreto de firma generado para esa aplicación (mínimo 32 caracteres) |
   | `MP_WORKER_SECRET` | Secreto aleatorio independiente, mínimo 32 caracteres |
   | `MP_ALLOWED_ORIGIN` | Origen HTTPS exacto de pruebas, sin path, query ni barra final |
   | `DEMO_ACTOR_SECRET` | Reutilizar el secreto antiabuso existente, sin cambiarlo |

   Supabase inyecta URL y service-role en Edge. No copiar ninguna clave privada al
   frontend, repositorio, consola de navegador, ticket o chat. La plantilla
   `supabase/functions/.env.example` solo tiene nombres y valores vacíos; para
   desarrollo local usar archivo ignorado en `work/`, nunca `.env` del frontend.
   `MP_ALLOWED_ORIGIN` está separado de `DEMO_ALLOWED_ORIGIN`: esta fase no cambia
   el origen del checkout demo ya desplegado ni la configuración Auth.
3. Tras aprobación, desplegar **únicamente** `mp-checkout`, `mp-webhook` y
   `mp-reconcile`, con `supabase/config.toml`. Ejemplo de operación manual:
   `supabase functions deploy mp-webhook --project-ref <PROJECT_REF_VERIFICADO>`.
   Repetir para las otras dos; no desplegar todo el proyecto ni reemplazar
   `demo-orders`. Mantener creación apagada mientras se comprueba configuración.
4. Configurar en la aplicación MP el webhook HTTPS
   `https://<PROJECT_REF_VERIFICADO>.supabase.co/functions/v1/mp-webhook`, tópico
   **Order (Mercado Pago)**. Comprobar firma/ID reales. La simulación del panel no
   acredita un pago: el ID debe existir y ser consultable con el token de prueba.
   No habilitar eventos/cobros productivos por instrucciones genéricas del panel.
5. Configurar privadamente Vault, por Dashboard, con `vanta_mp_worker_url`
   (URL HTTPS de `mp-reconcile` en **el mismo proyecto**) y
   `vanta_mp_worker_secret` (mismo valor que `MP_WORKER_SECRET`, sin imprimirlo).
   Verificar `pg_cron`, `pg_net` y Vault antes de aprobar
   `supabase/operations/stage-8-schedule.sql`. El script no instala extensiones;
   requiere permisos owner y crea solo `vanta-mp-reconcile`. No toca
   `vanta-demo-expiry`/`vanta-demo-retention`. `pg_net` encola invocaciones: el éxito
   de cron no demuestra éxito HTTP del worker; verificar respuesta y cola.
6. Tras revisar IDs, activar SQL con un UPDATE explícito **solo** a la fila nueva
   de `public.mp_test_config`: `seller_id`/`application_id` deben coincidir con los
   secretos y `enabled=true`. La plantilla `stage-8-activate.example.sql` se niega
   a ejecutar hasta completar ambos IDs numéricos. No guardar Access Tokens en SQL. Activar el flag de
   Edge solo después de comprobar las protecciones de identidad y permisos.
7. Ejecutar una prueba controlada aprobada: crear un pedido MP demo con el
   endpoint anterior (Turnstile real), invocar `mp-checkout` con esa referencia y
   capacidad privada; abrir su `checkout_url` con comprador/tarjeta de prueba.
   Comprobar webhook, GET al proveedor, un pago aplicado, un solo consumo y estado
   `confirmed`. Utilizar los scripts read-only `stage-8-verify.sql` para verificar
   invariantes. No manipular reservas o pedidos previos para simular expiración.
8. Validar rechazo, pendiente, cancelación y aprobación tardía en sandbox. Para
   acelerar vencimiento utilizar el entorno PostgreSQL descartable de pruebas,
   no cambiar fechas/inventario del proyecto alojado. La UI aún no conecta estos
   endpoints y no se envía ningún correo: corresponden a las fases siguientes.

Para pruebas externas desde Codex harían falta credenciales disponibles por el
mecanismo seguro del entorno, autorización de esa prueba y acceso de red a
`api.mercadopago.com` y `api.mercadolibre.com`. No se intentó eludir la política
actual ni usar credenciales administrativas del navegador.

## Reversión

**Con actividad:** ejecutar manualmente, tras aprobación, `stage-8-disable.sql` y
poner `MP_CHECKOUT_ENABLED=false`. Mantener webhook, credencial de prueba, worker
y cron de vencimiento hasta conciliar todas las operaciones en vuelo. La búsqueda
read-only de respuestas perdidas continúa, pero no emite nuevas creaciones. No
eliminar pagos/eventos ni quitar el trigger de seguridad. Para detener además el
worker, primero verificar que no queden operaciones pendientes y conservar los
registros para conciliación manual posterior.

**Antes de cualquier actividad:** `stage-8-rollback.sql` comprueba que no haya filas
MP nuevas ni eventos de esta fase, retira solo los objetos nuevos y restaura los
grants originales capturados. Se niega a actuar si hubo actividad. No usa CASCADE,
no borra pedidos/inventario y no revierte Auth ni migraciones de etapas anteriores.

## Pruebas realizadas y límites

Resultados exactos registrados en la PR. Se agregaron:

- Unitarias de protocolo, cantidades/centavos, identidad test, firmas e inyección,
  tipos/monedas/importes, errores HTTP/red/JSON, URLs y redacción de diagnósticos.
- Integración handlers → SQL real PGlite con proveedor **simulado**: creación,
  webhook, duplicados, recuperación de respuesta perdida, cambio de estado,
  límites, falsificación y aprobación tardía. No es una compra real en MP.
- PostgreSQL 17 nativo descartable: ocho escenarios concurrentes; incluye
  aprobación esperando inventario que vence, cancelación/cron vs aprobación,
  leases, permisos y reversión. Sin esperar 60 minutos, sin acceso remoto.
- Harness Auth nativo local actualizado para aplicar también la migración nueva:
  Magic Link/contraseña/MFA conservados; JWT administrativo no ejecuta RPC de pagos.
- Suites existentes, lint, TypeScript frontend/Edge, build y audit. No se agregó
  dependencia de SDK al frontend/backend: el SDK oficial solo se inspeccionó como
  referencia de interoperabilidad; runtime usa fetch/WebCrypto compatibles con Deno.

**Pendiente real:** aplicar la migración, desplegar funciones, verificar endpoint
`users/me` con el token concreto, firma de una notificación real, recursos/medios
habilitados de la cuenta argentina, vigencia `PT1H`, forma efectiva de respuestas
Orders API, programación HTTP y una compra sandbox completa. No se ejecutó un
runtime Supabase/Deno alojado ni se afirma haberlo validado mediante tests Node.
Un contrato inesperado mantiene la integración cerrada; requiere revisar la
causa y agregar una regresión, no eliminar checks de entorno o de monto.

Fuentes oficiales:

- [Orders API: creación e idempotencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/create-order/post)
- [Redirecciones en config.online](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/web-integration/configure-back-urls)
- [Webhooks de Orders](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications)
- [SDK oficial: firma de webhooks](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md)
- [Identidad autenticada y tag test_user](https://developers.mercadolibre.com.ar/consulta-usuarios)
- [Búsqueda de orders](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/search-orders/get)
- [Cancelación](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/cancel-order/post)
- [Programar Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)

Resultados locales de esta entrega: `npm run check` aprobó **537 pruebas en 41
archivos**, lint, TypeScript frontend/Edge y build. PostgreSQL nativo aprobó los
**8 escenarios nuevos** y los **11 escenarios existentes**. Las tres suites de
Auth nativo (`auth`, `email`, `passkeys`) pasaron con la migración de pagos;
`npm audit` devolvió **0 vulnerabilidades**. Las regresiones E2E de navegador y
la ejecución Linux/Windows de CI se registran con su estado real en la PR.
