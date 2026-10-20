# Etapa 5 — Revisión de cierre

Rama `feat/stage-5-orders-stock`, PR #6. Revisión del 20/10/2026.

## Dictamen

No se encontraron errores nuevos de producción en los flujos revisados. La etapa
es apta para cierre técnico cuando las suites de esta revisión y CI estén verdes.
No se exige otra ronda de pedidos manuales: se reforzó y ejecutó el vencimiento
acelerado en PostgreSQL aislado. Los resultados finales del commit se consignan
en la [PR #6](https://github.com/davidjosem925-collab/vanta-urban-wear/pull/6).

Esta entrega cambia solo pruebas y documentación. No requiere desplegar otra
Edge, cambiar configuración/secretos ni aplicar SQL en el proyecto remoto.

## Flujos auditados

| Flujo | Resultado y protección comprobada |
|---|---|
| Creación | Validación de publicación, cantidades, precio del servidor en centavos y disponibilidad; snapshots y reserva atómicos, rollback completo ante error. |
| Idempotencia | Misma clave/capacidad/payload devuelve el mismo comprobante; otro propietario o payload se rechaza; reintentos concurrentes reservan una sola vez; tombstones impiden reutilizar intentos purgados. |
| Recuperación | Consulta independiente sin challenge ni creación; ausencia conserva identidad y selección, sin consultas obligatorias indefinidas; no se descuenta carrito sin comprobante válido. |
| Cancelación | Capacidad obligatoria, función accesible solo a la Edge autorizada; libera una sola vez. Cancelación después del deadline resuelve como vencimiento. |
| Vencimiento | `pending → expired`, reservas `active → expired`, sello de resolución y un movimiento `expire`; reduce reserved y restaura disponibilidad sin disminuir on_hand. |
| Concurrencia | Última unidad, misma clave, dos jobs de expiración, cancelación contra expiración y confirmación bloqueada hasta después del deadline; sin doble liberación ni consumo tardío. |
| Seguridad | RLS, EXECUTE mínimo, bloqueo de DML directo, helpers/cron inaccesibles a roles API y admin activo requerido. Turnstile, origen, validación estricta, límites durables y diagnósticos sin datos sensibles permanecen intactos. |

La reserva vence exactamente a creación del servidor +60 minutos. La liberación
material del job ocurre en su primer tick disponible posterior; un job por minuto
no garantiza liberar en el segundo exacto. Replay/resolución también comprueban el
deadline; un pedido vencido no puede consumirse aunque el scheduler se retrase.

## Vencimiento acelerado reproducible

Se amplió `scripts/test-orders-postgres.mjs`, que usa exclusivamente el socket
Docker local y una base descartable `vanta_stage5_test`; no acepta DSN remoto.
El contenedor de esta revisión se creó sin red externa ni puertos publicados.

1. Dos pedidos comparten una variante con dos unidades físicas: reserved=2,
   disponible=0; ambos tienen plazo exacto de 60 minutos y no vencen antes de tiempo.
2. Solo en esa base de prueba se desplazan fechas del primer pedido y su reserva
   61 minutos al pasado, conservando la relación creación +60m.
3. Dos conexiones ejecutan simultáneamente **el mismo comando del cron**:
   `select public.demo_expire_orders();`. Entre ambas resuelven exactamente uno.
4. Primer pedido expired/reserva expired/resolución registrada; segundo pedido
   pending/reserva active intactos. on_hand=2, reserved=1, disponible=1.
5. Hay un único movimiento expire por una unidad y ningún consume. Repetir el job
   devuelve cero. Replay de la clave vencida conserva referencia/estado sin reservar
   otra vez, y otro pedido puede utilizar la unidad liberada.

Además se reforzó la prueba SQL/PGlite existente para verificar on_hand,
disponibilidad, estado de reserva, resolución y movimiento único. La nueva prueba
PostgreSQL se ejecuta automáticamente en el job `orders-postgres` de CI, sin
modificar el SQL productivo ni esperar una hora.

Comandos de la revisión:

```sh
npm run check
npm audit
npm run demo:check
npm run images:check
npm run test:e2e
npm run test:e2e:orders
VANTA_TEST_PG_CONTAINER=contenedor_local_descartable npm run test:orders:postgres
deno test --no-config --allow-net=127.0.0.1 supabase/tests/siteverify.deno.ts
```

`check` incluye las suites frontend/backend/SQL/PGlite, lint, TypeScript frontend
y Edge y build. Playwright ejecuta 50 regresiones y 30 recorridos de pedidos en
320, 375, 393, 820 y 1440 px. Deno comprueba HTTP/formulario real local sin llamar a
Cloudflare/Supabase. Las comprobaciones de catálogo/imágenes son offline. CI
comprueba adicionalmente portabilidad de imágenes en Windows/Ubuntu.

## Evidencia remota y límite de esta revisión

El operador confirmó migración aplicada, Edge/Turnstile funcionales, un pedido
pending con una reserva y una unidad reservada, plazo 60m y pg_cron instalado con
`vanta-demo-expiry` cada minuto en succeeded. Se toma como evidencia aportada por
el operador; no se vuelve a generar otro pedido para repetirla.

**No se inspeccionó ni modificó ese pedido remoto ni se observó aquí su cambio a
expired.** El entorno dispone de configuración pública del catálogo, no de acceso
administrativo de solo lectura a orders/stock_reservations/inventory y a
cron.job_run_details para certificarlo de manera independiente. No se propone
abrir RLS ni otorgar permisos nuevos para esta revisión. Se probó la función real
de expiración con PostgreSQL 17 y el mismo rol propietario que usa el job; no se
instaló ni probó el scheduler pg_cron local. El scheduler remoto está sustentado
por la comprobación del operador, no por mocks ni por una afirmación de acceso.

## Qué falta y pasos mínimos

Sin bloqueos funcionales detectados. Permanece la advertencia previa del bundle
principal (~507 kB, ~149 kB gzip), sin ampliar umbrales para ocultarla. El seguimiento
operativo del cron sigue siendo responsabilidad habitual del despliegue; no se
requiere alterar fechas ni contadores remotos para cerrar el código de la etapa.

1. Confirmar CI verde del último commit y aprobar el diff final de pruebas/informe.
2. Quitar Draft y fusionar manualmente la PR #6 hacia main.
3. Actualizar main local y crear la rama de etapa 6 sobre ese main, con el alcance
   administrativo acordado. No se implementó el panel ni se inició esa rama aquí.
