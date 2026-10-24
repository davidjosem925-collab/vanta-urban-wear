# Orders API: diagnóstico de INVALID_PROVIDER_RESPONSE

> Registro histórico. El contrato funcional posterior y su activación manual están en [Evidencia de órdenes v2](mp-order-evidence-v2.md). Esa revisión separa importe desconocido de acreditación; no normaliza ausencia a cero.

## Evidencia y límite del diagnóstico

Se revisaron `provider.ts`, `core.ts`, `handlers.ts`, `runtime.ts`, los contratos SQL existentes y las pruebas. No se invocó Mercado Pago, no se crearon transacciones, no se consultaron cuerpos privados ni se modificó Supabase remoto.

La evidencia recibida es HTTP 503 / `INVALID_PROVIDER_RESPONSE`, pedido pendiente y `mp_order_id` vacío. Eso **no identifica por sí solo el campo rechazado** ni prueba que el POST no haya creado una orden en MP. No se dispone de una respuesta real sanitizada o de una validación identificada del entorno alojado. No se declara resuelto el fallo concreto del proveedor sin esa evidencia.

Problema comprobado y corregido: `snapshot()` agrupaba controles distintos bajo un error indistinguible; errores de tipos/importes también perdían la ubicación del fallo. Ahora el diagnóstico identifica una validación estática y la operación `create` o `get`, manteniendo la respuesta pública genérica. El logger de `runtime.ts` ya publica el objeto estructurado del handler; no necesita cambios.

## Contraste con documentación oficial (23/10/2026)

- [Guía de creación Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order): POST `/v1/orders`, `type=online`, `processing_mode=manual`, importes decimales como strings, ítems con título, cantidad y precio unitario. El backend ya envía la solicitud congelada de SQL y la misma clave de idempotencia; no se alteró.
- [Referencia POST](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro/create-order/post): respuesta 201 con URL de checkout. La guía muestra `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTST…`. Se conserva la URL exacta vinculada al ID, sin aceptar hosts alternativos, puertos, credenciales, fragmentos o parámetros extra. La referencia presenta también un ejemplo con dominio incompleto; eso no autoriza a redirigir a un dominio diferente o inválido.
- [Referencia GET](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro/get-order/get): GET `/v1/orders/{order_id}`, respuesta 200. Puede omitir `checkout_url`; el código ya admite su ausencia y SQL conserva la URL previamente vinculada. No se inventa una URL para una orden no vinculada.
- [Pruebas de integración](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/integration-test-introduction): consultar el ID de la orden para verificarla; una redirección no es evidencia de aprobación.

Los ejemplos de la guía son compatibles con las validaciones actuales. Los `ORDTST…` de la guía pasan el patrón existente. Los ejemplos GET genéricos con `ORD…` no justifican aceptar órdenes productivas. `user_id` y `integration_data.application_id` siguen comparándose con las identidades esperadas. Moneda ARS, país ARG, referencia, importe y multiconjunto de títulos/cantidades/precios siguen siendo obligatorios. Campos adicionales de ítems/integración se ignoran; no sustituyen la evidencia exigida. No se convierten importes numéricos ambiguos ni se suplanta evidencia faltante con el request local.

**Conclusión:** no se confirmó una incompatibilidad del formato documentado con el parser. Una variación del URL, campo ausente/tipo distinto o identidad/importes no coincidentes son hipótesis, no causas demostradas. No se amplió la aceptación del proveedor por conjetura.

## Diagnóstico seguro

Ejemplo sintético, no extraído de una transacción:

```json
{"event":"mp_test_diagnostic","operation":"checkout","outcome":"INVALID_PROVIDER_RESPONSE","http_status":503,"dependency":"create","validation":"checkout_url"}
```

`validation` contiene solo un nombre definido en el código: `response_object`, `order_id`, `bound_order_id`, `order_type`, `processing_mode`, `currency`, `country`, `reference`, `seller`, `application`, `total_amount`, `live_mode`, `paid_amount`, `updated_at`, `items`, `item_fields`, `item_match`, `checkout_url`, `json_body`, `search_results` o `search_resource`.

No se registran valores recibidos, URLs, IDs de órdenes, claves de idempotencia, IP, tokens, capacidades, secretos, contactos ni cuerpos completos. `json_body` identifica un cuerpo no procesable dentro del límite existente; `upstream_status`, cuando está disponible, es solo un código HTTP. El navegador recibe el código genérico anterior. Un fallo del logger no cambia el resultado de negocio.

## Creación, enlace y recuperación

1. Se obtiene/autorizan el pedido y su pago local; se reclama el lease de creación.
2. Se verifica la identidad de vendedor de prueba; se envía el POST con la clave persistente y el request congelado.
3. Antes de `mp_test_apply`, se valida la respuesta. Si falla, no se vincula ID ni se acepta estado financiero. La orden de MP podría existir aunque el ID local siga vacío.
4. El worker busca por la referencia y ventana existentes; si encuentra una sola candidata, obtiene el recurso mediante GET y vuelve a validar íntegramente. No se vincula por el mero resultado de búsqueda.
5. Sin candidata, la lógica existente puede reintentar el POST con la misma clave, dentro de sus límites. No se cambiaron esos reintentos, leases ni reservas.

**HTTP 200 del worker no equivale a conciliación exitosa.** Revisar `processed`, `retry` y `outcome` del diagnóstico. El worker mantiene HTTP 200 con `retry>0` cuando una dependencia o validación falla. Se agregaron regresiones que comprueban ese comportamiento.

## Siguiente comprobación mínima, sin nuevas compras

Esta PR no despliega nada. Para identificar la causa alojada hace falta, tras aprobación de despliegue, el diagnóstico de una **lectura de la orden existente**. Si el vendedor dispone del ID en Mercado Pago, puede consultarlo por el GET oficial en un entorno privado. No compartir el token ni el cuerpo completo de esa consulta. El ID local nulo no permite inferir que el proveedor no tiene la orden.

No crear otro pedido, no cambiar referencias/claves ni ejecutar SQL para vincular manualmente. No invocar `create` ni lanzar manualmente el worker como una prueba de solo lectura: el worker tiene una rama de creación cuando no encuentra candidata. Los reintentos ya programados conservan su comportamiento anterior.

Después de un despliegue autorizado, observar el diagnóstico del flujo existente y compartir únicamente `operation`, `outcome`, `dependency`, `validation` y códigos HTTP. Con ese dato se puede comprobar el campo preciso y decidir una adaptación compatible; no hace falta exponer la respuesta. Si muestra `checkout_url`, verificar localmente su esquema/host/ruta/parámetro contra la guía antes de proponer cambios; si muestra identidad o importe, mantener el rechazo.

Si el fallo persiste o no se autoriza desplegar el diagnóstico, la causa exacta queda pendiente. No activar producción ni intentar otra compra para obtener evidencia.

## Pruebas

Fixtures del proveedor, sin credenciales reales; SQL ejecutado en PostgreSQL WASM/PGlite aislado. Casos de creación documentada, GET sin URL, campos inválidos y límites de URL/identidad/importes/ítems. Integración de rechazo tras creación seguida de búsqueda+GET: una orden local, una reserva, un solo POST y stock sin consumo. Casos de respuesta perdida, idempotencia, webhooks y aprobaciones tardías anteriores conservados. `npm run check` aprobado: **716 pruebas en 52 archivos**, lint, TypeScript de Edge/frontend y build. Suite focalizada de proveedor/handler: **119 aprobadas**, incluidas en las 716. Las regresiones de navegador se detallan en la PR. No son pruebas con Mercado Pago ni Supabase alojados.

## Activación y reversión

No hacen falta cambios de SQL, datos, secretos, flags o frontend. Si se aprueba más adelante el despliegue, las funciones que empaquetan estos módulos compartidos son `mp-checkout`, `mp-webhook` y `mp-reconcile`; no se ejecutan aquí. Reversión: volver a la revisión anterior de esas funciones. Es una reversión del diagnóstico, no de órdenes ni reservas; no borrar ni editar registros para revertir.

## Evidencia posterior: `paid_amount` en GET (versión alojada 8)

El diagnóstico proporcionado por el propietario identifica `operation=worker`, `dependency=get`, `validation=paid_amount`, `outcome=INVALID_PROVIDER_RESPONSE`, HTTP 200. El pedido observado sigue pendiente/unlinked con 8 intentos y una reserva. No se consultaron ni modificaron esos registros durante esta revisión.

**Demostrado:** el recurso validado llegó al control del total pagado y falló al parsearlo o al compararlo con el importe congelado del pedido. Las verificaciones anteriores de identidad, aplicación, referencia y total de orden no rechazaron ese recurso. Las comprobaciones posteriores de fecha, productos y URL no llegaron a ejecutarse en esa respuesta; no se declaran verificadas. Sin identificadores en los logs, tampoco se debe usar un evento aislado como prueba de correlación con cualquier otro pedido.

**No demostrado:** que el campo esté ausente, sea `null`, numérico, un texto inválido o un importe excesivo. Tampoco que el estado financiero del proveedor sea aprobado. Los 8 intentos no autorizan a reiniciar contadores, generar nuevas referencias ni vincular una orden por SQL.

### Contrato y cambio mínimo

La [guía oficial de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order) documenta `total_paid_amount` como **string**, monto pagado hasta el momento, y muestra texto decimal para una orden recién creada. La [referencia GET](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/get-order/get) también ejemplifica texto decimal. Esos ejemplos no establecen que ausencia, `null` o un JSON number equivalgan a cero, ni autorizan una coerción numérica.

El parser `cents()` permanece intacto: sin `Number(value)`, fallback, conversión de `null`/ausencia a cero ni reconstrucción desde transacciones o desde el importe del pedido. El mismo límite de total pagado y las mismas condiciones de aprobación siguen vigentes.

Solo se añade `validation_detail` al diagnóstico interno para `validation=paid_amount`:

| Categoría | Significado |
| --- | --- |
| `missing` | El campo no está presente (o es `undefined` en una fixture local; JSON no representa `undefined`). |
| `null` | El valor JSON es `null`. |
| `number` | El valor JSON es numérico; se rechaza incluso cero o un entero seguro. |
| `invalid_text` | Es texto que `cents()` no acepta, por formato o por su rango máximo existente. |
| `unsupported_type` | Booleano, objeto o arreglo. |
| `exceeds_order` | Texto decimal aceptado por `cents()`, pero superior al total congelado de la orden. |

Las categorías se registran **solo al rechazar**. No se registra el contenido, longitud, importe parseado, ID, token, contacto ni cuerpo del proveedor. Las respuestas públicas permanecen genéricas. Los textos decimales válidos, incluido cero explícito, conservan su tratamiento anterior y no implican pago aprobado.

Ejemplo sintético:

```json
{"event":"mp_test_diagnostic","operation":"worker","outcome":"INVALID_PROVIDER_RESPONSE","dependency":"get","validation":"paid_amount","validation_detail":"missing","http_status":200}
```

La categoría real requiere observar un nuevo diagnóstico del proveedor tras un despliegue autorizado; este trabajo **no lo despliega ni llama a MP**. Si confirma ausencia/null/número, falta contrastar esa forma concreta con soporte/documentación de Mercado Pago antes de adaptar el contrato. Si confirma texto inválido o exceso, mantener el rechazo y verificarlo privadamente con el proveedor sin publicar importes o respuestas. No crear otra compra, resetear intentos ni alterar la reserva para diagnosticar.

### Pruebas adicionales

25 regresiones: campo realmente omitido, `undefined` de fixture, `null`, números (incluido cero), formatos de texto inválidos y límites, tipos no admitidos, total excesivo y textos válidos exactos. En integración aislada, cada categoría se propaga desde un GET de una orden no vinculada al diagnóstico del worker, manteniendo error público genérico, estado pending/unlinked, una reserva, stock intacto y un solo POST inicial simulado. No se expone la referencia ni la clave de idempotencia en los diagnósticos. `npm run check` aprobado: **741 pruebas / 52 archivos**, lint, TypeScript de Edge/frontend y build. Suite focalizada: **144 aprobadas**, incluidas en las 741. Sin pruebas con el proveedor real ni nuevas pruebas de navegador, porque el cambio solo añade categorías internas al backend. No se modifican datos, SQL, secretos ni funciones desplegadas.
