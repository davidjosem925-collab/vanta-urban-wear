# Incremento: `created` sin detalle ni importe pagado

## Causa confirmada

La consulta privada aportada por el propietario encontró una sola orden de la referencia investigada, con `status=created`, `status_detail` ausente y `total_paid_amount` ausente. La PR #16 aceptaba importe desconocido únicamente para `created/created`: al faltar el detalle no entraba en esa vía y `cents(undefined)` terminaba en `paid_amount/missing`.

La [referencia oficial de creación](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/create-order/post) define `created` como orden creada, no como pago aprobado. La [guía de Checkout Pro](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/create-order?scope=prod) muestra un detalle explícito en su ejemplo, pero ese ejemplo no representa la forma observada. La adaptación de VANTA se apoya en el estado verificado y conserva como desconocidos los campos omitidos: no afirma que la documentación garantice ausencia equivalente a cero o un detalle implícito.

No se consultó esa referencia ni se ejecutaron operaciones reales durante el desarrollo. Los tests utilizan referencias aleatorias/ficticias, no el identificador del pedido del propietario.

## Cambio acotado

- `created` admite `status_detail` **ausente**, además del detalle explícito `created` ya permitido. Si falta, el snapshot privado contiene `provider_detail: null`, nunca el texto inventado `created` o `undefined`.
- Sin `total_paid_amount`, permanece `paid_cents: null`, `paid_evidence: unreported`. No hay fallback a cero ni evidencia de acreditación.
- `status_detail` ausente en cualquier otro estado se rechaza con diagnóstico estático `validation=status_detail`. También se rechazan `null` explícito, texto vacío, números, objetos o arreglos como detalle. La excepción es ausencia real en `created`.
- `processed/accredited` sigue exigiendo ambos valores explícitos y el importe exacto. La RPC rechaza evidencia monetaria desconocida para aprobar; si una solicitud de aprobación incluye metadatos remotos, estos no pueden contradecir `processed/accredited` ni contener detalle desconocido. Snapshots numéricos legados sin esos metadatos conservan compatibilidad.
- Todos los controles de identidad, vendedor de prueba, aplicación, referencia, ARS/país, ítems congelados, importe total, fecha, URL y transacciones contradictorias de la #16 siguen ejecutándose.

`handlers.ts` conserva el enlace y la hidratación de URL del mismo ID. Además, una recuperación con pago local aún no vinculado busca la referencia congelada y valida el recurso por GET, sin esperar al worker. Si no encuentra candidato, no crea una orden ni repite un POST. Se mantienen autorización por capacidad, límites de solicitudes, validación completa y clave persistente; no se repite la reserva ni se amplían URLs.

## SQL incremental

La migración de la #16 `202610240001_mp_payment_evidence.sql` **no se edita ni se reaplica**. La nueva `202610240002_mp_created_without_detail.sql` modifica exclusivamente la RPC existente:

- Permite `provider_state=created` con `provider_detail` **JSON null explícito** solo si el snapshot está normalizado como pendiente, sin importe informado y sin evidencia local protegida.
- No permite que `provider_detail` simplemente falte en el contrato privado SQL. Edge representa expresamente la omisión del proveedor mediante null.
- Mantiene el bloqueo de importes positivos previos, liquidaciones, revisiones protegidas y todos los controles SQL anteriores.
- Conserva firma, dueño, SECURITY DEFINER, search_path y ACL. No añade columnas, no actualiza filas ni flags y no cambia RLS.
- Verifica el fingerprint de la RPC v2 anterior para no sobrescribir una personalización. Se normalizan solo CRLF/LF.

## Activación manual — no ejecutada

1. Revisar/aprobar el incremento. Confirmar que la migración `202610240001_mp_payment_evidence.sql` de la #16 ya esté aplicada. Si no lo está, seguir primero su [guía v2](mp-order-evidence-v2.md); no ejecutarla de nuevo si ya existe.
2. Comprobar de solo lectura la firma/ACL/fingerprint de `mp_test_apply` con las consultas de la guía v2. La guarda de la nueva migración exige la definición v2 exacta, normalizada por saltos de línea. Si devuelve `EVIDENCE_V2_RPC_REQUIRED`, comparar la definición y las migraciones aplicadas; no quitar la guarda.
3. Tras autorización del propietario SQL, aplicar **solo** `supabase/migrations/202610240002_mp_created_without_detail.sql`, completo (BEGIN/COMMIT), una vez. No ejecutar semillas, editar pedidos o resetear intentos.
4. Después de aprobación de despliegue, actualizar `mp-checkout`, `mp-webhook` y `mp-reconcile`, que empaquetan el módulo compartido, con la configuración existente. SQL primero; no cambiar secretos, gateway, flags ni activar producción. No hay cambios de frontend.
5. Observar la recuperación del recurso existente sin crear otra compra automáticamente. Mientras el pedido local siga pendiente y dentro de plazo, una observación válida puede vincular el ID y devolver su URL canónica. Si ya venció, no se reabre ni se entrega una URL de pago.
6. La comprobación con el sandbox alojado queda pendiente de esa activación autorizada. Si aparecen otros campos obligatorios ausentes, transacciones contradictorias o una URL no permitida, el recurso se mantiene bloqueado. No se rellenan esos campos por suposición.

## Reversión

`supabase/operations/mp-created-without-detail-rollback.sql` restaura exactamente la RPC de la #16, sin borrar columnas ni filas. Valida el fingerprint actual y **rechaza revertir si hay cualquier pago con evidencia `unreported`**, incluso si nació con la #16: no se conserva una marca histórica suficiente para distinguir cuáles observaciones necesitan este incremento. Para una reversión estructural completa, restaurar primero esta migración 002 y recién después evaluar la reversión 001 de la #16. No eliminar ni modificar evidencia para forzar la reversión.

Si existen operaciones sin importe, detener nuevas creaciones mediante el procedimiento aprobado y conservar procesadores compatibles hasta resolverlas; preparar una corrección hacia adelante. Un simple regreso al parser anterior volvería a bloquear la respuesta observada.

## Verificación

- Pruebas HTTP + SQL aislado de la forma observada: POST 201, URL validada por el frontend, recuperación búsqueda+GET, repetición sin duplicados, cancelación idempotente, rechazo de aprobación incompleta y posterior acreditación explícita exacta.
- Matriz de detalles ausentes/no válidos y controles de identidad/ítems/moneda/URL/transacciones. La referencia real no se incorpora a fixtures ni logs.
- Migración SQL: NULL explícito acotado a creación, imposibilidad de acreditar con evidencia desconocida o contradictoria, filas/flags/ACL intactos, compatibilidad CRLF y reversión exacta/protegida.
- PostgreSQL 17 descartable sin red: escenarios concurrentes de enlace con detalle null, aprobación, cancelación, stock y cadena de reversión. No Supabase remoto.

`npm run check` aprobado: **879 pruebas / 54 archivos**, lint, TypeScript frontend/Edge y build; 38 casos nuevos sobre la #16. Recuperación directa repetida con búsqueda sin candidato y posterior GET: aprobada, sin otro POST. PostgreSQL 17 local: **14 escenarios** aprobados. Navegador: **10 casos** aprobados a 1440 y 393 px, con proveedores interceptados. `git diff --check` aprobado. PR incremental basada en la #16. No se declara probada una redirección o una compra real sandbox alojada; todas las respuestas del proveedor en tests son simuladas. No hubo despliegues, fusiones, pagos o compras reales.
