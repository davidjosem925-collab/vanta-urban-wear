# Checkout Pro: estado de orden y evidencia monetaria separados

> Incremento posterior: para `created` con `status_detail` ausente, ver [compatibilidad acotada y migración 002](mp-created-detail-increment.md). No reaplicar la migración 001.

Esta revisión sustituye la decisión conservadora de las PR #12–#15 mediante un **contrato explícito**, no mediante un default de cero. Está basada en la PR #15. No se ejecutaron consultas/transacciones MP reales, migraciones remotas, cambios de configuración ni despliegues.

## Causa y solución

`POST /v1/orders` podía crear la orden, pero `snapshot()` exigía `total_paid_amount` antes de vincularla o devolver la URL. El GET posterior observado para la referencia vencida no tenía ese campo y seguía rechazándose. El contrato SQL también exigía un número para cualquier estado. Una orden creada sin evidencia monetaria no podía atravesar ese contrato, aunque todavía no hubiese ninguna acreditación que autorizar.

La solución permite validar y vincular el **ciclo de vida** independientemente de la **acreditación**:

| Evidencia | Representación privada | Uso |
| --- | --- | --- |
| Importe decimal explícito válido | `paid_cents` entero; `paid_evidence=reported` | Se conserva el importe realmente informado. Solo la acreditación explícita y exacta puede aprobar. |
| Campo ausente en un par de estados permitido | `paid_cents=null`; `paid_evidence=unreported`; estado/detalle remotos explícitos | Vincular, devolver una URL segura mientras sigue pendiente o reconocer cancelación. Nunca aprobar ni suponer cero. |
| Históricos anteriores a la migración | Nuevas columnas ambas NULL | Sin backfill ni reconstrucción de evidencia histórica. No se interpretan como cero. |

Solo se admite importe no informado para:

- `created/created`.
- `processing/in_process` o `processing/pending_review_manual`.
- `canceled/expired`, `canceled/canceled` o `canceled/canceled_transaction`.

Se conserva la distinción de estados locales y remotos. Un `pending` literal del proveedor no se convierte en `created`. `null` explícito, números JSON y textos inválidos no se convierten a desconocido ni a cero. `failed`, `refunded`, `processed`, autorizaciones y estados/detalles desconocidos sin importe siguen bloqueados.

## Respaldo y límites del contrato

- [Creación de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order): POST manual/online y URL directa. La documentación muestra texto decimal, pero no garantiza que omisión signifique cero. No hacemos esa inferencia.
- [Estados de Orders API](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/payment-management/status/order-status?scope=prod): creación/procesamiento no son acreditación; `processed/accredited` identifica acreditación. Cancelación/vencimiento no completa la compra.
- [Cancelación por API](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/cancel-order/post): documenta el detalle `canceled_transaction`. El par `canceled/expired` tiene además evidencia real aportada por el propietario.
- [GET de Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/get-order/get): la consulta autenticada vuelve a validar el recurso completo. No se utilizan campos del navegador como prueba financiera.

Esta es una decisión explícita de VANTA para representar una observación incompleta como **desconocida**, no una afirmación de que MP garantice importe cero o de que no pueda existir evidencia adicional. Las contradicciones de la vía sin importe se bloquean.

## Controles mantenidos

Se validan íntegramente ID sandbox y vínculo previo, vendedor de prueba autenticado AR/MLA, aplicación esperada, país/moneda, referencia, total exacto, ítems congelados, cantidades/precios, fecha y URL. No se alteró `cents()`, el request persistente, la clave de idempotencia ni el bloqueo productivo.

La vía sin importe no admite:

- Acreditación, devolución, revisión protegida o cumplimiento ya registrados localmente; tampoco puede volver a poner pendiente un pago terminal.
- Transacciones hijas acreditadas/autorizadas/devueltas, importes pagados o confirmados positivos, reembolsos o contracargos presentes, tipos malformados o estados incompatibles. Las transacciones fallidas/canceladas no se suman para fabricar cero.
- Borrar un importe positivo previamente informado: SQL vuelve a comprobarlo bajo bloqueo, incluso si el contexto Edge se quedó desactualizado.

`processed/accredited` sin importe sigue rechazado. Con importe insuficiente queda en revisión, con exceso se rechaza y solo con importe exacto puede liquidar. Las reservas siguen usando los bloqueos, plazos y primitiva existentes; no hay una ruta alternativa de consumo.

## POST, URL y GET

1. POST usa la identidad autenticada, solicitud congelada y clave persistente existentes.
2. Una respuesta `created/created` sin total pagado puede validarse completamente, vincularse y devolver la URL antes del vencimiento.
3. Se acepta únicamente la URL argentina exacta de checkout vinculada al mismo ID `ORDTST…`. No se amplían hosts, parámetros, fragmentos ni credenciales.
4. Si un POST válido omite la URL, se **vincula primero** y se consulta por GET ese ID ya validado. No se repite el POST ni se fabrica la URL.
5. Si GET también omite la URL, la orden sigue vinculada sin redirección disponible. Si ofrece una URL insegura o faltan otros campos obligatorios, permanece bloqueada; se conserva diagnóstico seguro.
6. GET sin URL puede conservar una URL ya validada anteriormente. Un pedido vencido/cancelado o en revisión nunca la publica al comprador.

Una respuesta POST perdida se recupera mediante búsqueda por referencia seguida de GET y validación completa. La reserva no se vuelve a crear. El worker conserva sus leases/reintentos y las respuestas privadas no aparecen en logs.

El pedido investigado ya vencido **no se reabre**. Un recurso `canceled/expired` puede cerrar su conciliación; si localmente aún está pendiente se cancela usando la primitiva existente, y si el plazo local ya venció conserva `expired`. Una acreditación tardía va a revisión sin consumir unidades liberadas.

## Archivos y migración

- `provider.ts`: evidencia discriminada (`reported`/`unreported`) y controles de contradicciones.
- `handlers.ts`: hidratación de URL por GET del mismo recurso ya vinculado.
- `202610240001_mp_payment_evidence.sql`: columnas privadas nullable `mp_paid_amount_cents` y `mp_paid_evidence`, constraint coherente y reemplazo acotado de `mp_test_apply`.
- `mp-payment-evidence-rollback.sql`: restaura la RPC anterior solo antes de registrar evidencia nueva.

No se actualizan filas históricas ni flags. La misma RPC mantiene firma, SECURITY DEFINER, search_path y ACL. No se conceden permisos a anon/authenticated ni DML al frontend. Las columnas nuevas no aparecen en la respuesta pública ni en las consultas administrativas autorizadas existentes.

## Activación manual, solo después de aprobar la revisión

**No ejecutado.** No desplegar el backend nuevo sin la migración: la RPC anterior rechaza el importe desconocido, y podría haberse creado una orden externa antes de ese rechazo.

1. Confirmar qué migraciones de etapa 8 ya están aplicadas. No reaplicar las anteriores ni reactivar flags. Esta migración requiere la RPC financiera de la etapa 8 sin personalizaciones inesperadas.
2. Revisar de solo lectura la definición/firma, ACL y configuración de la RPC. Puede obtenerse su fingerprint sin imprimir el cuerpo:

   ```sql
   select md5(replace(prosrc,E'\r\n',E'\n')) as definition_fingerprint,
          prosecdef, proconfig, proacl
   from pg_proc
   where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure;
   ```

   El fingerprint esperado está en la guarda de la migración. Si difiere, la migración aborta con `UNEXPECTED_PAYMENT_RPC`: comparar la personalización antes de proseguir; no quitar esa protección. Se normaliza únicamente CRLF/LF para aceptar SQL equivalente de Windows.
3. Con el propietario SQL autorizado, ejecutar **solo** `supabase/migrations/202610240001_mp_payment_evidence.sql`, completo (BEGIN/COMMIT), una vez. No ejecutar las semillas ni modificar pedidos existentes.
4. Verificar antes del despliegue:

   ```sql
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema='public' and table_name='payments'
     and column_name in ('mp_paid_amount_cents','mp_paid_evidence');
   select pg_get_constraintdef(oid)
   from pg_constraint
   where conrelid='public.payments'::regclass
     and conname='mp_paid_evidence_check';
   select has_function_privilege('anon',
     'public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE') as anon_execute,
     has_function_privilege('authenticated',
     'public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE') as authenticated_execute,
     has_function_privilege('service_role',
     'public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE') as edge_execute;
   ```

   Esperado: ambas columnas nullable; constraint presente; permisos false/false/true. Las filas anteriores conservan ambas columnas nuevas NULL, hasta recibir una observación validada posterior.
5. Después de aprobación explícita, desplegar las tres funciones que empaquetan los módulos compartidos: `mp-checkout`, `mp-webhook`, `mp-reconcile`, utilizando la configuración existente de `supabase/config.toml`. No cambiar autenticación del gateway, secretos, credenciales ni flags.
6. Observar la conciliación del recurso vencido ya existente: nunca debe devolver una URL ni reabrir/reservar stock. No enlazarlo por SQL ni resetear intentos.
7. Solo cuando el propietario autorice una compra sandbox controlada, verificar un pedido **nuevo** antes de su plazo: enlace y URL seguros, estado pendiente, evidencia NULL/unreported si MP omite el campo, retorno no autoritativo y acreditación solo tras evidencia explícita exacta. Esa prueba alojada no se realizó aquí. No utilizar cuentas/tarjetas reales.

No se necesita un cambio de frontend ni publicar en Vercel para este contrato; no se activan Resend o pagos desde esta PR.

## Reversión

- Operativa: si aparece un problema, detener nuevas creaciones mediante el procedimiento aprobado de flags, conservando conciliación y expiraciones. No borrar órdenes ni evidencia para forzar una reversión.
- Estructural antes de uso: ejecutar manualmente `supabase/operations/mp-payment-evidence-rollback.sql` **solo con aprobación**, antes de revertir la etapa 8. Restaura exactamente la RPC anterior y sus permisos. Verifica también el fingerprint de la RPC nueva para no sobrescribir cambios ajenos.
- Si hubo cualquier evidencia `reported` o `unreported`, la reversión estructural se rechaza con `PAYMENT_EVIDENCE_ACTIVITY_PRESENT`. Conservar el esquema y los procesadores compatibles para operaciones abiertas; preparar una corrección hacia adelante. Volver simplemente al parser anterior dejaría los recursos sin importe nuevamente bloqueados.

## Validación y límites reales

Las pruebas incluyen proveedor simulado + SQL real WASM/PGlite con todas las migraciones de pagos/correo/administración, compatibilidad de snapshots anteriores, ausencia diferenciada de cero, permisos, seguridad, restauración exacta y preservación de históricos. PostgreSQL 17 nativo local verifica concurrencia de enlace, aprobación, cancelación, expiración y reversión. Las regresiones de navegador utilizan proveedores interceptados.

`npm run check` aprobado: **841 pruebas / 53 archivos**, lint, TypeScript frontend/Edge y build. Se agregaron **66 casos** sobre la base de la PR #15. PostgreSQL 17 local: **14 escenarios** de pagos/concurrencia aprobados. Navegador: **25 casos** aprobados a 1440, 820, 375, 393 y 320 px, sin reintentos fallidos. `git diff --check` aprobado. No se considera probada una compra sandbox alojada: siguen pendientes la respuesta concreta de un POST nuevo, entrega de su URL real, runtime Edge alojado y posterior conciliación con MP. Si MP omite identidad, moneda, ítems o devuelve otra URL, ese escenario continúa bloqueado; no se rellenan esos campos ni se aceptan redirecciones arbitrarias.
