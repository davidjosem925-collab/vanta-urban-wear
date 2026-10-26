# Endurecimiento de sandbox y contexto privado

Incremento sobre la PR #20 (`ede9feb`), conservando #18, #19 y #20. No requiere SQL,
nuevos secretos, frontend ni cambios de configuración.

## Cambios

- `provider.ts / snapshot()`: si la respuesta JSON contiene `live_mode`, su único
  valor permitido es el booleano `false`. Rechaza `true`, textos, números, null,
  objetos y arreglos. Ausencia del campo mantiene el contrato existente: siguen
  siendo obligatorias la identidad test autenticada, ORDTST, identidad del recurso,
  vendedor, aplicación, referencia, ARS, ítems/total y evidencia financiera.
  No se convierte una ausencia en un valor ni se infiere acreditación.
- `Provider.assertContext()`: compara por igualdad estricta seller_id y
  application_id del contexto congelado contra la configuración privada del
  servidor, validada por el handler. El navegador no aporta esas identidades.
- `Provider.create/find/cancel`: comprueba ese contexto antes de cualquier
  solicitud al proveedor. `create()` sigue verificando /users/me antes del POST.
- `handlers.ts`: comprueba el contexto antes de reclamar creación, recuperar,
  conciliar o aplicar un resultado. Un pago vinculado inconsistente tampoco se
  consulta desde checkout/worker. El worker verifica además la coherencia de la
  configuración SQL antes de crear como fallback tras búsqueda vacía.
- Webhook: la firma y los datos de aplicación/vendedor/live_mode del evento siguen
  siendo obligatorios. Su primer GET requiere identidad test y permite localizar
  la referencia; cuando conoce el contexto local, valida su coherencia antes de
  aplicar una aprobación. No se acepta el cuerpo del webhook como evidencia.

`Provider.get(id)` sigue verificando /users/me; no recibe un vendedor del cliente.
Un token de vendedor no test, otra identidad, país/sitio incorrecto o cuenta no
activa siguen bloqueados. APP_USR es solo sintaxis, nunca prueba de sandbox.
No se añade una rama productiva ni se relajan las restricciones de URL/pref_id.

## Fallos seguros y recuperación

Una identidad congelada/configuración inconsistente produce NOT_CONFIGURED y
bloquea la creación antes del POST; en los recorridos de checkout y conciliación
se rechaza también antes del GET/búsqueda cuando el contexto ya está disponible.
El worker conserva su contrato HTTP 200 con retry>0 y diagnóstico NOT_CONFIGURED
si falla un elemento del lote; HTTP 200 no significa que lo haya conciliado.
No se imprimen IDs, claves, tokens, referencias, cuerpos ni datos personales.

Una respuesta POST con live_mode inválido necesariamente se conoce después del
POST: podría existir una orden externa de prueba, pero no se vincula ni acredita
por esa respuesta. Se conserva recuperación con la misma referencia/capacidad,
búsqueda+GET e idempotencia; no se fabrica una segunda operación ni un importe.
Una respuesta GET inválida tampoco permite cambiar el pago o consumir stock.
No borrar filas ni regenerar claves/capacidades para resolver estos errores.

## Activación manual — no ejecutada

1. Revisar esta PR incremental sobre #20 y confirmar que el proyecto seleccionado
   por Supabase CLI sea VANTA. Mantener los SQL y configuración actuales.
2. Con autorización, desplegar **las tres funciones** desde esta misma revisión:

   ```sh
   supabase functions deploy mp-checkout
   supabase functions deploy mp-webhook
   supabase functions deploy mp-reconcile
   ```

   Sus entrypoints `supabase/functions/mp-*/index.ts` incorporan los cambios en
   `_shared/mp-orders/provider.ts` y `_shared/mp-orders/handlers.ts`. No desplegar
   módulos compartidos como funciones independientes. Conservar config.toml.
3. Confirmar que los tres bundles correspondan a esta revisión antes de evaluar
   el resultado. No cambiar MP_MODE, vendedor/aplicación, claves, flags ni cron.
   No desplegar demo-email-worker, frontend o Vercel por este incremento.
4. Revisar diagnósticos existentes sin provocar compras: NOT_CONFIGURED identifica
   incoherencia privada; INVALID_PROVIDER_RESPONSE/validation=live_mode identifica
   respuesta no admitida. No publicar cuerpos ni valores recibidos. Una prueba
   alojada posterior requiere autorización aparte; no usar tarjetas reales.

**No hay migración nueva y no se reaplican las anteriores.** No hay que modificar
pedidos, inventario, reservas, permisos, secretos o eventos para activar esto.
Las filas y claves congeladas siguen siendo compatibles con la revisión anterior.

## Reversión

Si fuera necesaria y se aprueba expresamente, desplegar otra vez mp-checkout,
mp-webhook y mp-reconcile desde el commit previo `ede9feb` de #20. No restaurar
versiones anteriores a #18/#19/#20 ni modificar SQL o datos.

Esa reversión reintroduce las dos debilidades de validación conocidas; es
preferible corregir hacia adelante. Nunca "resolver" NOT_CONFIGURED cambiando
el vendedor de un pedido, relajando test_user o habilitando producción.

## Validación local

Las suites de proveedor/handlers incluyen respuestas simuladas y PostgreSQL
local aislado en PGlite. Se comprueban presencia/ausencia/tipos de live_mode,
contextos discrepantes de creación y recuperación, worker vinculado/sin vínculo,
configuración SQL desalineada, webhook con contexto incorrecto y la identidad
no test en crear/consultar/buscar/cancelar. Los controles positivos previos de
pref_id, importes, idempotencia, stock y correo #20 se ejecutan en la suite completa.
No se usan credenciales reales ni se contacta a Mercado Pago/Supabase/Resend.

Resultados ejecutados: `npm run check` aprobado con **1.046 pruebas / 59 archivos**
(57 casos nuevos sobre #20), lint, TypeScript Edge/frontend y build. También
`git diff --check` aprobado. No se requirió repetir PostgreSQL nativo ni navegador:
no cambian SQL ni frontend; la suite ejecutada incluye integración handler/SQL
PGlite y regresiones del checkout, reservas y correo. La validación alojada sigue
pendiente de un despliegue autorizado; no se presenta como prueba realizada.
