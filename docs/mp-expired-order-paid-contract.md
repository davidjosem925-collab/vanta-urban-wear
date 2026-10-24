# Orden `canceled/expired` sin total pagado

> Registro histórico. El contrato funcional posterior y su activación manual están en [Evidencia de órdenes v2](mp-order-evidence-v2.md). Esa revisión separa importe desconocido de acreditación; no normaliza ausencia a cero.

## Evidencia recibida y decisión

La consulta privada del propietario encontró una única orden con `status=canceled`, `status_detail=expired` y sin `total_paid_amount`. Esto identifica por qué la versión 9 rechaza el GET en `paid_amount/missing`; no es un timeout ni una falla de firma. No se volvió a consultar a MP ni se crearon transacciones durante este trabajo.

Se evaluó una excepción exclusivamente terminal. **No se implementa todavía**, conforme a la alternativa conservadora de la solicitud: la documentación consultada permite reconocer conceptualmente una cancelación/vencimiento, pero no define la semántica del importe omitido para ese par exacto ni garantiza ausencia de evidencia financiera contradictoria. Esta PR conserva el parser, documenta el bloqueo y agrega regresiones de cancelación, seguridad y liberación por vencimiento local.

## Documentación oficial y límites

- [Estados de Checkout Pro Orders API](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/payment-management/status/order-status?scope=prod): describe `canceled/canceled` como cancelación o expiración sin completar el pago; distingue `processed/accredited` y las devoluciones. El par exacto `canceled/expired` observado no está detallado en esa tabla.
- [Cancelaciones y devoluciones de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/refunds-cancellations): distingue una cancelación previa a la aprobación de un reembolso posterior al procesamiento. No define una equivalencia entre `total_paid_amount` omitido y cero.
- [Vigencia de órdenes](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/additional-settings/define-order-validity): define el vencimiento como plazo para completar el pago; no documenta el campo omitido en la respuesta terminal.
- [Referencia GET de Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/get-order/get): ejemplifica un total pagado explícito. No publica una excepción financiera por omisión para `canceled/expired`.

Las reglas de `/merchant_orders`, Point, QR o Checkout API no se trasladan automáticamente a Checkout Pro. Tampoco se toma una etiqueta `omitempty` de un SDK como garantía sobre pagos parciales o importes desconocidos.

**Lo que sí está sustentado:** cancelación no es acreditación y una orden vencida no debe abrir una nueva compra ni reservar nuevamente stock.

**Lo que falta para la adaptación:** confirmación de MP sobre el contrato del par exacto en Checkout Pro `online/manual` sandbox Argentina: condiciones bajo las que omite el campo, si puede coexistir con autorizaciones/capturas parciales/reembolsos y cómo detectarlas. No hace falta repetir el diagnóstico de ausencia ni el estado remoto, que ya fueron aportados.

## Por qué no usar un cero técnico

El contrato existente de `Snapshot`/`mp_test_apply` exige `paid_cents` numérico incluso al cancelar. Pasar cero para hacer que acepte la cancelación introduciría un importe que la respuesta no contiene. Que una compra no esté completada no demuestra por sí solo el monto histórico de cualquier transacción parcial. No se cambia a un default cero ni se usa el importe solicitado como importe pagado.

Una futura solución podría representar explícitamente «importe desconocido» en un evento terminal separado de la evidencia de acreditación, pero exige un contrato confirmado y una revisión incremental de RPC/SQL. No se introduce por conjetura ni se sustituye por una aprobación del navegador.

`processed/accredited` sigue exigiendo total pagado explícito, válido y exactamente igual al total congelado. Importes insuficientes no aprueban, excesos se rechazan y un recurso terminal no evita los controles de ID, vendedor, aplicación, moneda, referencia, total, ítems, fechas y URL.

## Reserva local: independencia del proveedor

Se comprobó en SQL aislado que el vencimiento local de 60 minutos **no depende** de aceptar ese GET ni de tener `mp_order_id` vinculado. `demo_expire_orders()` llama a la primitiva existente que bloquea/revalida el inventario, cambia la reserva a `expired` y libera sus unidades una sola vez. El importe no se inventa y no hay consumo de existencias.

Regresión completa:

1. Una respuesta simulada incompleta deja el pago sin vincular, con una reserva activa.
2. El GET `canceled/expired` sin total es rechazado y no libera antes de tiempo por inferencia financiera.
3. Se adelanta únicamente el reloj de la fixture descartable más allá de 60 minutos y se ejecuta el vencimiento existente: una orden vencida, reserva vencida, unidades reservadas cero y existencias físicas intactas.
4. La segunda ejecución no libera nuevamente; un GET todavía incompleto no reabre ni duplica nada.
5. Una respuesta posterior simulada `processed/accredited` con importe explícito exacto se registra para revisión sin reabrir el pedido vencido ni consumir inventario liberado.

Esto verifica el comportamiento del código, **no la ejecución del cron alojado**. Si la reserva real sigue activa después del plazo, revisar de solo lectura el estado/plazo del pedido, estado de la reserva y últimas ejecuciones de `vanta-demo-expiry`; no resetear intentos, cambiar fechas, liberar manualmente ni crear otra compra como diagnóstico.

## Entrega y pendiente

Solo se modifican pruebas y esta documentación. No hay cambios de parser, funciones desplegables, SQL, datos, cron, secretos, flags o frontend. No hace falta desplegar esta PR y desplegarla no desbloquearía la conciliación MP incompleta. La integración remota sigue pendiente del contrato del proveedor; el TTL local conserva su funcionamiento.

La PR está basada en la #14 y no fusiona ninguna revisión anterior. `npm run check` aprobado: **775 pruebas / 52 archivos**, lint, TypeScript de Edge/frontend y build. La suite focalizada aprobó **178 pruebas**, incluidas en las 775, con 16 regresiones nuevas. `git diff --check` aprobado. Los recursos MP son fixtures; el SQL se ejecuta en PostgreSQL WASM/PGlite descartable. No se realizaron operaciones remotas.
