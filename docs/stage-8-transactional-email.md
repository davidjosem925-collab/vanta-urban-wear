# Etapa 8, fase 4: correo transaccional de demostración

## Estado y decisiones

Implementación preparada, desactivada por defecto. No se enviaron correos reales, ejecutaron migraciones remotas, desplegaron funciones ni cambiaron secretos durante el desarrollo. Las pruebas del proveedor son simuladas; PostgreSQL y Auth se verifican también en contenedores aislados. Falta comprobar Resend y el runtime alojado con configuración aprobada.

Resend se invoca exclusivamente desde `demo-email-worker` mediante su API REST oficial. No hay SDK ni credenciales en React. No se añade un webhook público: el worker consulta privadamente el ID del mensaje en Resend para registrar su entrega. La clave debe permitir **envío y consulta (`full_access`)**; una clave limitada a envío no permite este seguimiento. Usar una clave dedicada, con acceso restringido a los secretos del proyecto.

Fuentes oficiales:

- [Enviar](https://resend.com/docs/api-reference/emails/send-email), [consultar](https://resend.com/docs/api-reference/emails/retrieve-email) y [estados](https://resend.com/docs/dashboard/emails/manage-emails).
- [Idempotencia de 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys), [errores](https://resend.com/docs/api-reference/errors).
- [Restricción de resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [dominios](https://resend.com/docs/dashboard/domains/introduction), [permisos de claves](https://resend.com/docs/api-reference/api-keys/create-api-key).

## Eventos y compatibilidad

Solo los pedidos nuevos que solicitan correo y pasan la lista privada de destinatarios quedan inscritos. Los pedidos anteriores continúan funcionando y no se les asigna un destinatario retroactivamente. Repetir la creación conserva el pedido y destinatario originales. La recuperación nunca modifica el correo ni reenvía mensajes.

La creación del pedido, el contacto cifrado y el evento `order_received` son atómicos. Los triggers preparan `payment_pending`, `payment_approved`, `order_cancelled`, `reservation_expired` y `payment_review` a partir de filas verificadas del servidor. La aprobación requiere evidencia de Mercado Pago de prueba acreditada y conciliada y un pedido confirmado. Una aprobación tardía después del vencimiento genera revisión, nunca confirmación de pago aplicado ni consumo de stock. Una transferencia no puede aprobarse desde el navegador.

Cada par pedido/evento es único. Los pendientes obsoletos que todavía no se enviaron se suprimen al cambiar el estado. La solicitud completa a Resend (incluidos remitente, destinatario y plantilla) se congela cifrada y con hash antes del primer envío: los reintentos conservan los mismos bytes y clave `vanta-demo/<id>`, incluso después de un despliegue. La ventana automática es de **23 horas**, menor que las 24 horas de Resend. Si se pierde una respuesta no se inventa otra clave ni se envía indefinidamente: el trabajo pasa a revisión al agotar ventana/intentos.

El correo no modifica inventario, reservas, pagos ni pedidos. Las RPC existentes mantienen sus garantías. Las tablas nuevas tienen RLS y no conceden acceso directo ni siquiera a `service_role`; solo RPC específicas pueden operarlas. El administrador actual no obtiene acceso a direcciones, contenido cifrado ni un botón para enviar mensajes arbitrarios.

## Datos personales y límites

El formulario envía únicamente el correo validado, fuera del payload inmutable del pedido, mediante `notification_email`. No se guardan nombre, teléfono o domicilio reales. La dirección no se persiste en el navegador y se cifra con AES-256-GCM en el servidor, con contexto ligado al intento. La solicitud congelada también se cifra. El recibo solo informa `email_requested`, que **no significa correo enviado ni entregado**.

Los contactos y solicitudes cifrados se eliminan tras 30 días; los metadatos se purgan tras 90 días. El mantenimiento procesa lotes acotados. Los hashes de supresión por rebote/queja se conservan para evitar nuevos envíos al destinatario hasta revisión del propietario; no son direcciones en texto claro. Resend mantiene su propia retención: revisarla en la cuenta y explicar este tratamiento antes de invitar destinatarios.

Mantener el worker programado incluso con envíos deshabilitados para ejecutar la retención. No quitar/cambiar la clave de cifrado mientras existan trabajos o contactos retenidos; hacerlo impide descifrarlos y bloquea envíos de forma segura. No se implementa rotación automática de claves en esta fase.

Límites: lista obligatoria de hasta 20 destinatarios; 50 intentos POST diarios por defecto (máximo configurable 100); hasta 8 intentos de envío, 32 reclamaciones y 12 consultas de entrega por mensaje. Cada invocación procesa hasta dos envíos y dos consultas, con separación mínima de 600 ms entre llamadas. Respeta `Retry-After` acotado y aplica reintentos controlados. Un límite del proveedor puede agotar los intentos: revisar presupuesto antes de aumentar actividad.

`accepted` significa aceptado por la API; `delivered` significa aceptado por el servidor de correo destinatario, no lectura ni llegada a la bandeja principal. El seguimiento es acotado: una queja posterior al último sondeo puede verse solo en el Dashboard de Resend. Este worker no sustituye un sistema productivo de seguimiento continuo de rebotes.

Los registros solo contienen códigos cerrados y contadores. No incluir direcciones, tokens, capacidades, claves de idempotencia, IP, cuerpos ni secretos en logs o capturas de soporte.

## Configuración manual, después de aprobar los cambios

1. Revisar/aprobar la migración `supabase/migrations/202610230003_transactional_email.sql` y ejecutar primero `supabase/operations/stage-8-email-preflight.sql`. Confirmar fases 2 y 3 aplicadas. La migración no activa envíos ni crea tareas cron.
2. Crear la cuenta y clave dedicada en Resend. Sin dominio verificado, usar `onboarding@resend.dev` y **solo el correo propietario de la cuenta Resend** como destinatario. Para otros destinatarios, verificar un dominio/subdominio propio con los registros SPF/DKIM que indique Resend y cambiar el remitente. No se presupone un dominio definitivo. Desactivar seguimiento de aperturas/clics para estos correos transaccionales. No tocar SMTP de Supabase Auth: es otro circuito.
3. Preparar secretos privados de Edge Functions (no variables `VITE_`, no archivos versionados, no pegar valores en issues):

   | Nombre                          | Valor/propósito                                                                                                      |
   | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
   | `DEMO_EMAIL_ENABLED`            | inicialmente `false`; luego `true`                                                                                   |
   | `DEMO_EMAIL_MODE`               | exactamente `portfolio_demo`                                                                                         |
   | `RESEND_API_KEY`                | clave privada dedicada de Resend                                                                                     |
   | `RESEND_FROM_EMAIL`             | una dirección simple, autorizada por Resend, sin nombre decorativo                                                   |
   | `DEMO_EMAIL_ALLOWED_RECIPIENTS` | JSON de correos autorizados, por ejemplo `["owner@example.test"]`; reemplazar por destinatarios propios verificables |
   | `DEMO_EMAIL_ENCRYPTION_KEY`     | 32 bytes aleatorios codificados en base64; guardar respaldo privado seguro                                           |
   | `DEMO_EMAIL_WORKER_SECRET`      | secreto aleatorio independiente de al menos 32 caracteres                                                            |

   Supabase inyecta `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en las funciones. No copiarlas al navegador. Conservar todos los secretos Turnstile/pagos y `MP_MODE=test` existentes. En el worker no se habilitan credenciales productivas de Mercado Pago.

4. Aplicar **solo después de aprobación** la migración incremental y desplegar `demo-orders` actualizado y `demo-email-worker`. El worker usa `verify_jwt=false` porque valida su propio bearer privado; rechaza cuerpos distintos de `{}`. No exponer este bearer al comprador. El navegador jamás lo invoca.
5. Configurar en Vault, mediante Dashboard y sin escribir secretos en SQL versionado, `vanta_email_worker_url` (URL HTTPS del proyecto terminado en `/functions/v1/demo-email-worker`) y `vanta_email_worker_secret` (el mismo secreto privado del worker). Revisar `stage-8-email-schedule.sql`: exige pg_cron, pg_net y Vault ya disponibles; no instala extensiones. Su tarea separada no sustituye `vanta-demo-expiry` ni la conciliación de Mercado Pago.
6. Activar de forma coordinada el flag Edge y `stage-8-email-activate.example.sql`. Programar el worker manualmente con el archivo revisado. Activar **al final** `VITE_DEMO_EMAIL_ENABLED=true` y reconstruir el frontend, conservando flags de pedidos/pagos. Un desajuste falla de forma explícita y segura; no se crea un pedido sin correo fingiendo que se enviará.
7. Ejecutar `stage-8-email-verify.sql`. La consulta de permisos directos debe dar cero filas y los permisos de claim deben ser `false,false,true`. Inspeccionar estado HTTP de pg_net: que cron diga `succeeded` no prueba que el endpoint haya aceptado el trabajo. No seleccionar encabezados, respuestas completas ni secretos.

## Una prueba controlada y comprobaciones pendientes

- En entorno de pruebas, usar **un destinatario propio permitido** y crear una transferencia ficticia. No transferir dinero. Confirmar una sola creación/reserva, `email_requested`, evento recibido y pago pendiente; el pendiente puede suprimirse si el pedido ya cambió de estado antes de enviarlo. Verificar aceptación, entrega por ID y bandeja/spam. Revisar contenido, importes en centavos ARS, variantes, envío no cotizado y leyenda de demostración/no fiscal.
- Recargar/recuperar la misma operación: no debe añadir filas ni correos. No reenviar manualmente con otra clave una entrega incierta; consultar Resend por ID/tags y revisar el trabajo antes de cualquier intervención.
- Crear un único pago sandbox aprobado por Mercado Pago y comprobar que solo el estado verificado del servidor produce correo de pago aprobado. Probar rechazo/cancelación y vencimiento natural de la reserva. No adelantar relojes ni editar pedidos/inventario remotos para acelerar la prueba.
- Verificar en el panel que pedidos anteriores y nuevos continúan visibles; no hay cambios en autenticación Magic Link/contraseña, RLS administrativa o stock.
- Revisar HTML/texto en Gmail, Outlook y Mail de iPhone. Las capturas Chromium responsive no prueban renderizado en todos los clientes de correo. Probar límites de la cuenta Resend, remitente, dominio, runtime Deno alojado y cron privado.

## Pruebas locales reproducibles

```bash
npm ci
npm run check
npm audit
npm run email:preview
npm run test:e2e:notifications
```

`email:preview` genera seis pares HTML/texto en `work/email-preview/`, sin leer claves ni enviar mensajes. Las nuevas pruebas usan únicamente fixtures y Resend simulado: destinatario inválido, cifrado, colisiones, reintentos, límites, errores HTTP/red, respuesta perdida, aprobación tardía, arrendamientos y entrega. PostgreSQL nativo aislado verifica concurrencia y permisos:

```bash
# Contenedor PostgreSQL local desechable; nunca apuntar a un proyecto remoto.
VANTA_TEST_PG_CONTAINER=<contenedor-local> npm run test:emails:postgres
VANTA_TEST_PG_CONTAINER=<contenedor-local> npm run test:payments:postgres
npm run test:admin:email
```

Verificar el nombre exacto de la variable en el encabezado de cada harness antes de ejecutar; el contenedor no se configura mediante una URL remota. CI también ejecuta regresiones de carrito, checkout, administración y Auth aislado. No usar credenciales reales en estas suites.

## Desactivación y reversión

Para detener nuevos envíos, ejecutar manualmente el archivo revisado `stage-8-email-disable.sql`, poner `DEMO_EMAIL_ENABLED=false` en Edge y reconstruir con el flag frontend desactivado. Mantener el worker y secretos necesarios para mantenimiento. Deshabilitar no cancela un HTTP ya en vuelo ni retira un correo aceptado. No borrar evidencias, reiniciar estados o cambiar claves para forzar reenvíos.

`stage-8-email-rollback.sql` retira únicamente objetos de esta fase y restaura el recibo anterior, **solo si no hubo actividad**: rechaza la reversión si hay contactos, mensajes, presupuesto o supresiones. Con actividad, usar desactivación y preparar una migración de archivo revisada; no destruir registros. Revertir primero el cliente/Edge compatible antes de quitar las RPC. Los pedidos, pagos y reservas existentes permanecen intactos.

Para pausar pagos, mantener consulta/recuperación del checkout disponible hasta conciliar operaciones en curso; no apagar ciegamente el flag del frontend si impediría consultar pagos existentes. Este cambio no altera los procedimientos de seguridad, vencimiento y reversión de las fases de pagos.

## Evidencia de esta entrega

- Suite completa: 650 pruebas en 48 archivos; lint, TypeScript de frontend/Edge y build.
- PostgreSQL 17 local: 8 escenarios nuevos de correo y 10 de pagos, incluidos concurrencia, permisos, respuesta perdida, vencimiento y reversión.
- Auth local: las tres comprobaciones del harness por correo pasaron, con JWT firmados, autorización administrativa y denegación de RPC privadas; no se probó SMTP externo.
- Navegador Chromium: 10 casos nuevos en 1440, 820, 375, 393 y 320 px; plantillas revisadas visualmente en escritorio y móvil. Resend/Turnstile/Supabase interceptados mediante fixtures en esta suite.
- `npm audit`: cero vulnerabilidades. No se comprobó entrega real de Resend ni compra sandbox alojada; requieren los pasos manuales anteriores.
