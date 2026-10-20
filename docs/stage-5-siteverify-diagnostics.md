# Etapa 5 — Diagnóstico seguro de Siteverify y RPC

## Qué permite concluir la evidencia

El operador informó un 503 el **20/10/2026 a las 17:56:10 de Argentina
(20:56:10 UTC)**, con `EDGE_FUNCTION_ERROR`, ~1547 ms y el mensaje público
`CHALLENGE_UNAVAILABLE`. La recuperación posterior indicó ausencia del pedido y
los contadores seguían en cero. No se consultó Supabase desde esta revisión.

En el código anterior, ese mensaje salía exclusivamente de Siteverify: excepción
al enviar, HTTP no exitoso, lectura/parseo JSON fallido, respuesta sin objeto o
rechazo `internal-error` del proveedor. Los errores RPC devolvían `UNAVAILABLE`,
no ese mensaje. Por tanto, **con esa versión desplegada, la creación y admisión
no llegaron a ejecutarse en ese intento**, aunque sí habían corrido límite por
solicitante y replay. La etiqueta de plataforma `EDGE_FUNCTION_ERROR` no identifica
la rama ni demuestra por sí sola una excepción no controlada.

1547 ms no acredita haber agotado el timeout configurado de 8000 ms. Tampoco el
widget verde acredita que Siteverify aceptó el token desde la Edge. No hay
registros de etapas de esa ejecución pasada: la causa concreta debe identificarse
en una ejecución posterior instrumentada. No se atribuye sin pruebas a claves,
red, formato o Cloudflare.

## Implementación

- `diagnostics.ts`: un único `console.info` JSON por POST terminado, evento
  `demo_orders_diagnostic`, versión 1. Sin habilitar flags nuevos ni secretos.
  `index.ts` conecta explícitamente el logger y el transporte RPC instrumentado.
- `handler.ts`: registra etapas `siteverify` / `request`, `body`, `validation` y
  cada RPC por su nombre fijo, con duración, resultado y estado HTTP de upstream
  cuando existe. Mantiene los mensajes públicos genéricos y códigos anteriores.
- `rpc.ts`: extrae el transporte que antes estaba en `index.ts`, conservando
  endpoint, autorización administrativa solo en Edge y timeout de 15000 ms.
  Distingue envío, lectura, JSON y rechazo RPC. Elimina detalles crudos de PostgREST
  en la frontera; conserva únicamente los códigos de negocio que ya usa el handler.
- El envío a Siteverify conserva POST y `URLSearchParams` con secreto y token;
  se hace explícito `Content-Type: application/x-www-form-urlencoded`. Fetch ya
  debe inferir ese tipo de un URLSearchParams; **no se afirma que su ausencia
  explícita fuera la causa**. No se añade IP ni se reenvían cabeceras del cliente.
- Se rechaza con 503 una respuesta JSON sin `success` booleano. No se considera
  una estructura inválida una verificación exitosa.
- No hay reintentos automáticos de Siteverify o RPC. No se cambian límites,
  orden de operaciones, SQL, hashes, idempotencia, locks, reservas ni vencimiento.
  Si escribir el diagnóstico falla, se conserva la respuesta: jamás se intenta
  repetir una creación que pudo haber quedado confirmada.

### Datos permitidos y excluidos

El registro contiene solo `event`, `version`, `http_status`, `duration_ms` y un
array acotado `steps` (máximo 12). Cada etapa tiene `operation`, `phase`, `outcome`,
`duration_ms`, y opcionalmente `upstream_status` y `reason`. Operaciones, fases y
resultados provienen de constantes del código; `reason` está en una lista cerrada.

Se permiten motivos estándar de Turnstile, diferencias de hostname/acción sin
sus valores, y códigos técnicos RPC conocidos: 42501, 42883, PGRST202, PGRST301,
23505, 23503, 23514 y P0001. Cualquier otro motivo se convierte en `other`.

**No se registran** tokens, secretos, capacidades (ni hashes), claves de
idempotencia, IP (ni bucket/hash), referencia de pedido, variantes, precios,
cantidades, datos personales, URLs, cabeceras, cuerpos ni mensajes/stacks crudos.
No se copian mensajes arbitrarios del proveedor o PostgREST. No se añaden
identificadores del visitante para correlacionar: el resumen de etapas viene en
un solo registro, correlacionable por hora y estado de la invocación en Supabase.
El contrato público no expone los detalles del diagnóstico.

Ejemplo ilustrativo, sin valores de una ejecución real:

```json
{"event":"demo_orders_diagnostic","version":1,"http_status":503,"duration_ms":1547,"steps":[{"operation":"demo_rate_limit","phase":"result","outcome":"ok","duration_ms":100},{"operation":"demo_order_replay","phase":"result","outcome":"ok","duration_ms":100},{"operation":"siteverify","phase":"request","outcome":"http_error","duration_ms":1347,"upstream_status":502}]}
```

### Cómo interpretar el último paso fallido

| Operación / fase / resultado | Interpretación y siguiente comprobación |
|---|---|
| siteverify / request / network_error | Fetch lanzó antes de obtener respuesta; revisar conectividad de salida de la Edge con el operador. No se capturan DNS, certificados ni mensajes crudos. |
| siteverify / request / http_error | Cloudflare devolvió HTTP no 2xx; `upstream_status` contiene su estado, separado del 503 público. No se lee ni registra ese cuerpo. |
| siteverify / request o body / timeout | Se abortó el plazo o se recibió excepción de timeout/abort; el tiempo del paso permite contrastarlo con 8000 ms. |
| siteverify / body / invalid_json | Se obtuvo HTTP 2xx pero el cuerpo no pudo parsearse como JSON. |
| siteverify / body / network_error | La lectura del cuerpo falló por transporte, después de obtener cabeceras. |
| siteverify / body / invalid_response | El JSON no cumple la estructura mínima (`success` booleano). |
| siteverify / validation / rejected | Revisar `reason`: `internal-error` es fallo del proveedor; `timeout-or-duplicate` pide nuevo token; motivos de secreto piden revisión manual de la pareja de claves. No se imprime ninguna clave. |
| siteverify / validation / rejected con hostname_mismatch o action_mismatch | Revisar configuración del sitio y acción `demo-order`, sin devolver ni registrar sus valores reales. |
| demo_* / request o body / error | Fallo de transporte/lectura en esa RPC exacta. Si `demo_create_order` pudo ejecutarse, el resultado es incierto: conservar identidad y recuperar, sin crear otro intento. |
| demo_* / result / rpc_error | PostgREST devolvió rechazo; estado y código permitidos distinguen, por ejemplo, permisos (42501) o función/caché de esquema (42883/PGRST202). Nunca conceder permisos amplios para sortearlo. |
| demo_rate_limit o demo_admit_creation / result / rejected | El límite respondió negativamente; 429 normal. Esperar, sin resetear ni relajar límites. |
| request / body o validation / unexpected_error | Excepción fuera de los transportes identificados; respuesta segura 503, sin stack. |

`ok` en una RPC significa que devolvió sin error; un replay `ok` puede no haber
encontrado pedido. Recuperación sigue siendo de solo consulta y no usa Siteverify.

## Una sola prueba real controlada (manual)

Esta revisión **no despliega**, modifica secretos/datos remotos ni reaplica SQL.
Después de aprobar el diff, el operador autorizado puede:

1. Actualizar esta rama y desplegar **solo** la función con su configuración
   existente. No modificar secretos, RLS, migraciones o cron para instalar logs:

   ```sh
   supabase functions deploy demo-orders --project-ref evlbfjvvljbkntlozokt --no-verify-jwt
   ```

   La opción coincide con la configuración existente de esta función pública;
   no se desactivan origen exacto, Turnstile, capacidad o límites del handler.
2. Abrir Logs de `demo-orders` en Supabase y preparar el filtro de texto
   `demo_orders_diagnostic`. Anotar la hora actual UTC. No exportar HAR ni cuerpos
   de solicitudes. No habrá este evento para invocaciones anteriores al despliegue.
3. En una ventana sin otros probadores, obtener una línea base con esta consulta
   de **solo lectura**, antes y después del único intento:

   ```sql
   select
     (select count(*) from public.orders where is_demo) as demo_orders,
     (select count(*) from public.stock_reservations r
       join public.orders o on o.id = r.order_id
       where o.is_demo and r.status = 'active') as active_demo_reservations,
     (select coalesce(sum(r.quantity), 0) from public.stock_reservations r
       join public.orders o on o.id = r.order_id
       where o.is_demo and r.status = 'active') as demo_reserved_units,
     (select coalesce(sum(reserved), 0) from public.inventory) as inventory_reserved_units;
   ```

4. Conservar la misma pestaña y el intento pendiente; **no borrar sessionStorage**
   ni cambiar su selección para diagnosticar. Si no hay intento pendiente, usar
   una variante real y una unidad. Completar la revisión y una verificación nueva;
   pulsar **Confirmar pedido demo una sola vez**. Anotar hora, estado HTTP y código
   público seguro; no copiar payloads, tokens, capacidades ni datos del formulario.
5. Abrir el único resumen de diagnóstico de esa hora y observar la última etapa
   fallida. Compartir solo ese JSON seguro. No reenviar el registro completo de la
   plataforma, sus metadatos IP o encabezados. Si el resumen falta, comprobar que
   se desplegó esta revisión y si la invocación llegó al handler; no asumir Siteverify.
6. Si falla antes de `demo_create_order`, no debe haber cambios de pedidos o reservas
   atribuibles a ese intento. Si funciona, debe aparecer un comprobante real, un
   pedido nuevo y una reserva por variante de la selección original (una para la
   prueba de una unidad); el incremento de unidades reservadas debe coincidir con
   esa selección, sin cambiar `on_hand`. Cron/otros probadores pueden alterar los
   agregados: por eso se aísla la ventana. No corregir contadores a mano.
7. No repetir Confirmar dentro de esta prueba. Si el fallo ocurrió en creación o
   la respuesta se perdió, consultar **una vez** mediante la recuperación existente,
   que conserva la identidad y no crea reservas. Se mantiene el límite de seis
   peticiones/hora por bucket; un 429 exige esperar, no resetearlo. Dejar que la
   reserva demo exitosa siga su expiración habitual de 60 minutos y cron.

Con el evento concreto se podrá corregir la causa observada sin adivinar ni
reducir validaciones. Esta entrega añade observabilidad segura; **no certifica que
la creación remota ya funcione**, porque no ejecuta esa prueba contra Supabase.

## Pruebas automatizadas

`supabase/tests/demo-orders-diagnostics.test.ts` cubre red, timeout de envío y
lectura, HTTP 429/502, JSON inválido, estructura inválida, rechazos del proveedor,
hostname/acción, cada RPC, detalles PostgREST filtrados, configuración de plazos,
cableado real de `index.ts`, ausencia de secretos en logs y fallo del logger sin
repetir creación. Conserva las suites de recuperación, idempotencia y stock.
Resultados finales y CI se consignan en la PR #6.
