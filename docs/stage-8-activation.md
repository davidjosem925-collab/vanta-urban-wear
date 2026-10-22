# Etapa 8: activación manual y cierre técnico

Estado: implementación local y propuesta SQL; **no desplegada ni aplicada por este trabajo**. La tienda sigue siendo una demostración. No habilitar cobros productivos. La aprobación del código no sustituye las pruebas alojadas de Mercado Pago, Resend, Deno, DNS ni cron.

## 1. Revisar el estado existente y preparar reversión

Guardar un respaldo apropiado, revisar la PR #10 y registrar las migraciones ya aplicadas. No volver a aplicar las etapas 1–7 ni usar `db push` indiscriminadamente sobre un proyecto cuyo historial se llevó con SQL Editor. Revisar `stage-8-preflight.sql` y `stage-8-email-preflight.sql`; la ausencia de historial CLI no implica ausencia de tablas.

Conservar el acceso administrativo Magic Link/contraseña existente y sus sesiones/revocación. Esta etapa **no cambia `is_admin()`, `admin_membership()`, Auth, factores MFA ni políticas administrativas anteriores**. Las RPC nuevas llaman a `is_admin()` en el servidor; respetan tanto el modo de correo previamente aprobado como el modo legado con segundo factor.

No cambiar precios, productos ni inventario para preparar las pruebas. Dejar los flags de nuevas creaciones apagados durante la instalación. Con operaciones ya iniciadas, conservar consulta, webhook, conciliación y vencimientos hasta resolverlas.

## 2. Migraciones SQL, en este orden y una sola vez

Aplicar manualmente únicamente las pendientes, como propietario confiable, después de aprobar cada archivo:

| Orden | Migración                              | Efecto                                                                                                                       |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | `202610230001_mp_test_backend.sql`     | Pagos sandbox, eventos, verificación/conciliación, bloqueo de confirmación MP sin evidencia; configuración SQL deshabilitada |
| 2     | `202610230002_checkout_payments.sql`   | Retorno al checkout y preparación de transferencia ficticia                                                                  |
| 3     | `202610230003_transactional_email.sql` | Contacto cifrado, cola privada de correos y worker; envíos SQL deshabilitados                                                |
| 4     | `202610230004_admin_payments.sql`      | Consulta administrativa mínima, acciones auditadas/idempotentes y sincronización de transferencias vencidas                  |

La cuarta conserva el contrato booleano de `demo_admin_transition`, impide usarlo para aprobar MP y audita las operaciones nuevas. Restringe SELECT de `payments`/`payment_events` a columnas administrativas seguras, conservando RLS. No reescribe pagos anteriores ni modifica reservas. Los pedidos auditados sin pago se excluyen de la limpieza de demos para preservar evidencia; no hay purga automática del historial administrativo.

Revisar posibles consumidores propios que utilicen `SELECT *` de pagos: ahora deben pedir columnas seguras o usar `admin_demo_order_payments`. El frontend de VANTA usa esa RPC. No conceder escrituras directas para solucionar un error de permiso.

## 3. Secretos privados de Supabase Edge Functions

Configurar mediante el gestor de secretos, nunca en React, `.env` versionados, logs, capturas o SQL con valores literales:

| Grupo              | Variables                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pedidos existentes | `DEMO_ALLOWED_ORIGIN`, `DEMO_CHALLENGE_HOSTNAME`, `TURNSTILE_SECRET_KEY`, `DEMO_ACTOR_SECRET`                                                                                                              |
| Mercado Pago       | `MP_MODE=test`, `MP_CHECKOUT_ENABLED=false` inicialmente, `MP_ACCESS_TOKEN`, `MP_TEST_SELLER_ID`, `MP_APPLICATION_ID`, `MP_WEBHOOK_SECRET`, `MP_WORKER_SECRET`, `MP_ALLOWED_ORIGIN`                        |
| Resend             | `DEMO_EMAIL_ENABLED=false` inicialmente, `DEMO_EMAIL_MODE=portfolio_demo`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `DEMO_EMAIL_ALLOWED_RECIPIENTS`, `DEMO_EMAIL_ENCRYPTION_KEY`, `DEMO_EMAIL_WORKER_SECRET` |

Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` dentro de las funciones. Nunca publicar esa clave. Los secretos de workers deben ser independientes y aleatorios (al menos 32 caracteres). El cifrado de correo requiere exactamente 32 bytes aleatorios en base64 y un respaldo privado. Mantener la misma clave mientras haya contactos o trabajos retenidos.

No rotar `DEMO_ACTOR_SECRET` ni cambiar la configuración Auth como parte de esta activación. Conservar los orígenes/hostname de Turnstile correctos. No desactivar challenge, firmas, límites ni controles de identidad si el proveedor rechaza una prueba.

## 4. Mercado Pago: cuenta de prueba y HTTPS

Usar vendedor de prueba de Argentina, comprador distinto y tarjetas de prueba oficiales; no una cuenta vendedora real. Verificar ID del vendedor y de la aplicación. **El prefijo del token no demuestra que sea de prueba.** Orders API puede requerir credenciales del usuario de prueba con prefijo `APP_USR-` y rechazar las clásicas `TEST-`; no introducir un token productivo para sortearlo.

El código exige `MP_MODE=test`, identidad autenticada `test_user`, AR/MLA, vendedor/aplicación esperados y recursos `ORDTST…`. Si `/users/me` no permite verificar esa identidad con el token concreto, detener la activación y revisar el contrato oficial; no omitir esa comprobación.

Elegir un origen HTTPS aprobado para la prueba (dominio propio o entorno temporal autorizado). No se presupone un dominio definitivo. `DEMO_ALLOWED_ORIGIN`, `MP_ALLOWED_ORIGIN`, Turnstile y el frontend deben coincidir con su configuración prevista. Las nuevas URL de retorno apuntan a `/#/checkout/pago`; comprobar que Mercado Pago admite esas URL reales. La redirección **no confirma pagos**: VANTA consulta el servidor.

En Developers configurar notificaciones de **Orders** al endpoint HTTPS del proyecto `/functions/v1/mp-webhook`, con su secreto de firma en `MP_WEBHOOK_SECRET`. No usar un webhook de Preferences/Payments como sustituto ni añadir tokens a la URL. La recepción se autentica con firma HMAC y luego se verifica el recurso con GET. Confirmar que el evento real conserva los encabezados e ID previstos por el contrato.

[Contrato, fuentes oficiales y límites](stage-8-payments-backend.md). Sigue pendiente contrastar credenciales, permisos, evento y payload concretos con el sandbox alojado.

## 5. Resend y destinatarios

Crear una clave dedicada con permisos de envío y consulta de mensajes (`full_access` para el GET de seguimiento). Restringir el acceso humano a esa clave. Sin dominio verificado, `onboarding@resend.dev` solo admite el correo propietario de la cuenta Resend. No utilizar direcciones inventadas en la prueba real.

Para otros destinatarios, verificar un dominio/subdominio propio y configurar sus SPF/DKIM según Resend; usar un remitente autorizado. Desactivar seguimiento de aperturas/clics. Configurar una lista privada obligatoria de hasta 20 destinatarios que hayan autorizado la prueba. La verificación de dominio no elimina esa lista.

No cambiar SMTP de Supabase Auth: los Magic Links y la recuperación son un circuito independiente. [Guía de correo y retención](stage-8-transactional-email.md).

## 6. Funciones y tareas programadas

Tras la aprobación, desplegar las versiones de esta PR de:

- `demo-orders`: creación, recuperación, transferencia, contacto opcional cifrado.
- `mp-checkout`: preparar/recuperar Checkout Pro de prueba.
- `mp-webhook`: recibir y verificar eventos.
- `mp-reconcile`: worker privado de conciliación.
- `demo-email-worker`: worker privado de envío/consulta/retención.

Las funciones usan `verify_jwt=false` de forma intencional, con sus controles específicos: challenge/origen/capacidad, firma del proveedor o bearer privado del worker. No sustituirlos por acceso público sin comprobación. Las operaciones administrativas siguen siendo RPC autenticadas, sin una service key en el navegador.

Conservar `vanta-demo-expiry` cada minuto. Revisar y ejecutar manualmente los archivos de programación, que no instalan extensiones:

| Tarea           | Archivo                      | Secretos Vault                                        |
| --------------- | ---------------------------- | ----------------------------------------------------- |
| Conciliación MP | `stage-8-schedule.sql`       | `vanta_mp_worker_url`, `vanta_mp_worker_secret`       |
| Correo          | `stage-8-email-schedule.sql` | `vanta_email_worker_url`, `vanta_email_worker_secret` |

Vault contiene la URL HTTPS del endpoint correspondiente y el mismo bearer privado configurado en Edge. Crear entradas desde Dashboard sin pegar valores en archivos. Los jobs usan pg_cron/pg_net existentes; no reemplazan la tarea de vencimiento. Verificar sus respuestas HTTP en pg_net además de `succeeded` en cron. Nunca seleccionar headers o cuerpos completos para diagnóstico.

## 7. Activación coordinada de flags

1. Verificar migraciones, secretos, funciones y cron con nuevas creaciones/envíos apagados.
2. Activar configuración SQL MP con `stage-8-activate.example.sql`, completando solo los dos IDs numéricos de prueba verificados. Poner `MP_CHECKOUT_ENABLED=true` en Edge.
3. Activar configuración SQL de correo con `stage-8-email-activate.example.sql` y `DEMO_EMAIL_ENABLED=true` en Edge, cuando remitente/lista estén verificados.
4. Reconstruir el frontend al final con los valores públicos correctos:
   - URL/key pública de Supabase y `VITE_TURNSTILE_SITE_KEY`.
   - `VITE_DEMO_ORDERS_ENABLED=true`.
   - `VITE_MP_CHECKOUT_ENABLED=true`.
   - `VITE_DEMO_EMAIL_ENABLED=true` solo con correo preparado.
   - Conservar `VITE_ADMIN_EMAIL_ACCESS_ENABLED` en su estado ya aprobado. No activar passkeys o alterar MFA durante esta etapa.
5. Ejecutar `stage-8-verify.sql`, `stage-8-email-verify.sql` y `stage-8-admin-verify.sql`. No corregir permisos otorgando DML al navegador.

La fase administrativa no requiere nuevas credenciales ni un flag que eluda la autorización: exige la migración y el usuario activo en cada operación.

## 8. Aceptación manual real, acotada

Hacer las pruebas solo con cuentas, tarjetas y destinatarios propios autorizados. Registrar referencias y estados sin copiar capacidades, tokens, claves ni datos personales en logs/PR.

1. **Transferencia demo:** crear un pedido de una unidad, ver precio y estado pendiente separados. No transferir dinero. Desde el administrador registrar la transferencia ficticia con confirmación; verificar una acción auditada, un consumo de stock y estado de pago demo aprobado. Repetir la consulta/recargar no debe volver a consumir. Cancelar otro pedido pendiente debe liberar una sola vez. No se ofrecen reintegros ni cancelación de pedidos ya consumidos.
2. **MP sandbox:** crear una única operación con comprador/tarjeta de prueba, completar Checkout Pro alojado y volver. El retorno no debe aprobar hasta verificar el proveedor. Confirmar referencia, importe y operación `ORDTST…`, una reserva y un consumo. El administrador no debe ofrecer ni poder ejecutar una aprobación MP manual, ni siquiera llamando a la RPC antigua.
3. **Rechazo/cancelación/pendiente:** verificar estado financiero y del pedido por separado. Un rechazo no genera automáticamente otro recurso ni otra reserva; la reserva puede continuar hasta su vencimiento de 60 minutos. Cancelar una reserva MP no equivale a reintegrar al proveedor: la conciliación debe consultar/cancelar la operación externa. No confundir ambas acciones.
4. **Vencimiento/aprobación tardía:** esperar el vencimiento natural para una prueba alojada; no editar fechas, inventario o pedidos reales para acelerarlo. Confirmación posterior queda en revisión, sin reabrir ni consumir stock liberado. Las pruebas aisladas automatizan ese escenario sin esperar 60 minutos.
5. **Correo:** comprobar aceptación del API, consulta del ID y recepción en bandeja/spam. El recibido/pending se obtiene de eventos del servidor; el aprobado corresponde únicamente a MP verificado. **El registro de una transferencia ficticia no envía un correo que afirme aprobación de Mercado Pago.** El pedido conserva el historial administrativo de esa evolución. No hay backfill de correo de compras antiguas.
6. Revisar historial administrativo, permisos de usuario no administrador/inactivo, cierre de sesión, recarga y acceso por Magic Link/contraseña. Probar iPhone/Android y escritorio; Gmail, Outlook y Mail de iPhone pueden renderizar distinto que Chromium.
7. Corroborar que ningún error de Resend cambia stock o pago, que los eventos repetidos no duplican filas/correos y que los jobs mantienen avance sin superar límites. No rearmar manualmente una entrega incierta con otra clave después de la ventana idempotente.

## 9. Reversión segura

Primero detener **nuevas creaciones** con los flags Edge y configuración SQL de pagos; conservar webhook, conciliación y expiry para operaciones en curso. No apagar la UI de consulta de pagos mientras se necesite recuperar resultados. Deshabilitar envíos de correo con el archivo correspondiente y sus flags, conservando worker/cifrado para retención. Una petición ya en vuelo o aceptada no puede retirarse con un flag.

Volver a la UI anterior o retirar controles administrativos no devuelve stock consumido ni borra auditorías. No intentar marcar MP aprobado para corregir un error, cancelar pagos acreditados desde SQL ni simular reintegros.

Los rollbacks estructurales se aplican solo tras revisión, en orden inverso:

1. `stage-8-admin-rollback.sql`: **rechaza si hubo acciones auditadas**. Con actividad, conservar tabla/funciones y desactivar UI hasta una migración correctiva revisada.
2. `stage-8-email-rollback.sql`: rechaza si hubo actividad de correo; conservar evidencia y mantenimiento en tal caso.
3. `stage-8-checkout-rollback.sql`: antes, retirar clientes/funciones que dependan de la RPC de transferencia, sin impedir consulta de operaciones abiertas.
4. `stage-8-rollback.sql`: rechaza con actividad financiera; no borrar pagos para forzarlo.

Nunca reaplicar estas migraciones sobre objetos ya existentes. Con actividad, preferir desactivación y corrección incremental a eliminar datos. Conservar las garantías de stock y el registro de operaciones.

## Verificación automatizada y pendientes

Las pruebas nuevas cubren separación de estados, autorización servidor, columnas privadas, aprobación MP denegada incluso por RPC antigua, transferencia auditada/idempotente, conflictos, vencimiento tras espera de inventario, revocación, historial legado y retención de auditoría. SQL real en PostgreSQL 17 y Auth/GoTrue/PostgREST locales; Resend/MP/Turnstile simulados en integración y navegador. No hay credenciales reales en fixtures.

Ejecutar `npm run check`, `npm audit`, las suites PostgreSQL y Auth, y las suites Playwright generales/pedidos/pagos/correo. Las pruebas de navegador tienen anchos 1440, 820, 375, 393 y 320 px. La suite `notifications` usa flags propios y no debe incluirse en la configuración general que los deshabilita.

**Pendiente obligatorio antes de declarar la integración operativa:** token/cuenta y contrato Orders API real, firma y GET alojados, return URLs HTTPS, deploy Deno, cron HTTP, remitente/DNS/lista Resend y recepción real de correo. Ninguna suite simulada acredita esas comprobaciones.
