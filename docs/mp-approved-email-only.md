# Mercado Pago: un único correo de aprobación

Incremento sobre la PR #19; no activa ni despliega servicios.

## Política

Para pedidos cuyo método es `mercado_pago`:

- No se encolan ni envían `order_received`, `payment_pending`, cancelación,
  vencimiento o revisión. La única notificación es `payment_approved`.
- La aprobación requiere pedido confirmado/preparado/entregado y pago de prueba
  Mercado Pago `approved/settled`, vínculo de proveedor, acreditación, fecha y
  evidencia explícita `reported` con importe exacto igual al pago y al total.
  Una selección del navegador, un estado pendiente o una aprobación tardía en
  revisión no habilitan ese correo.
- Asunto de nuevas solicitudes: **VANTA Demo · Pago de prueba aprobado**.
  El detalle HTML/texto mantiene referencia, prendas, variantes, cantidades,
  precios unitarios/subtotales, envío, total y aclaración de portfolio/no factura.
- Transferencia y efectivo conservan sus reglas y asuntos anteriores.

Se conserva `UNIQUE(order_id,event)`, el mismo ID de outbox y la clave Resend
`vanta-demo/<id>`, el cuerpo cifrado congelado, los reintentos acotados y la ventana
conservadora de idempotencia. Un timeout o un ACK perdido no genera un nuevo ID.
No se promete entrega de correo si falla el proveedor o se agotan límites: se
mantiene la política existente de revisión, sin arriesgar envíos duplicados.

## Cambios

1. `supabase/migrations/202610250001_mp_approved_email_only.sql`: sustituye solo
   `demo_email_eligible`, `demo_email_maintenance` y `demo_email_begin`.
   Incluye propietario y huellas de las definiciones anteriores, normalizadas
   para LF/CRLF. Mantiene firmas, permisos, SECURITY DEFINER y search_path vacío.
   Requiere el contrato de evidencia de pagos de la 001 ya instalada.
2. `supabase/functions/_shared/demo-email/worker.ts`: bloquea también en el
   worker los snapshots de Mercado Pago distintos de aprobación, antes de
   descifrar/congelar/enviar. Se conserva la corrección HTTP 204 de #19.
3. `supabase/functions/_shared/demo-email/template.ts`: asunto exacto de la
   aprobación. No se modifica el detalle completo ni los avisos legales.
4. Pruebas de política, regresión y PostgreSQL nativo.

No se modifican checkout, frontend, pagos, inventario, reservas, reconciliación,
validación de Mercado Pago, credenciales ni las migraciones anteriores.

## Avisos antiguos y transición

La migración marca como `suppressed` los trabajos Mercado Pago no aprobados en
estado `queued/sending` sin `provider_id`, incluso con solicitud congelada o
intentos previos. Cancela sus leases/próximos intentos, pero no borra ni reescribe
sus cuerpos, hashes, IDs o historial de intentos. Mantenimiento aplica esa misma
política a trabajos antiguos residuales; `demo_email_begin` vuelve a comprobarla
incluso para reintentos ya iniciados.

Los registros `accepted`, su identificador Resend y su entrega se mantienen
intactos por esta transición y continúan bajo el seguimiento/retención original.
Los fallidos/revisión/suprimidos tampoco se reactivan. No se pueden retirar
mensajes que Resend ya haya recibido. La pausa/drenaje que sigue es obligatoria
para evitar que un bundle anterior tenga un POST en curso al cambiar de política.

Los correos de aprobación congelados previamente conservan su cuerpo y asunto
original (puede incluir la referencia en el asunto): reescribirlos rompería la
idempotencia del proveedor. Las nuevas solicitudes usan el asunto exacto pedido.
No se reenvían aprobaciones ya aceptadas. El catch-up existente solo puede crear
una aprobación ausente para pedidos ya inscritos, elegibles y con contacto aún
vigente; no se inscriben pedidos históricos ni se regeneran eventos existentes.

## Activación manual ordenada — no ejecutada

1. Confirmar el proyecto y esta revisión sobre #19; las migraciones 001/002/003 de
   pagos ya instaladas **no se editan ni reaplican**.
2. Pausar únicamente el job de correo `vanta-demo-email-worker` desde la
   administración de cron, y evitar invocaciones manuales. No pausar vencimientos,
   webhooks ni conciliación MP. Esperar a que terminen las invocaciones en curso
   y caduquen sus leases. Cambiar un flag no cancela una petición HTTP ya enviada.
   Ante una ejecución aún activa o incierta, no continuar la transición.
3. Revisar y ejecutar completa la **nueva** migración
   `202610250001_mp_approved_email_only.sql`, con BEGIN/COMMIT, como propietario.
   Si falla una huella, detenerse y comparar la definición real; no quitar guardas.
   El único cambio de filas es la supresión explícita de avisos obsoletos en
   outbox. No se actualizan pedidos, pagos, existencias ni contactos por migración.
4. Desplegar **solo `demo-email-worker`**, desde el árbol completo que incluye
   los dos módulos compartidos actualizados:

   ```sh
   supabase functions deploy demo-email-worker
   ```

   Entry point: `supabase/functions/demo-email-worker/index.ts`. No desplegar los
   archivos compartidos como funciones independientes. No se necesita build del
   frontend ni despliegue de funciones Mercado Pago.
5. Mantener los valores actuales de modo de prueba, remitente, destinatarios,
   cifrado, límites y flags. Este cambio no requiere nuevas claves ni activar
   correo si está deshabilitado. No habilitar producción.
6. Comprobar de solo lectura lo siguiente y reanudar el mismo job de correo solo
   después de que SQL y bundle sean compatibles. Si un paso falla, mantener el
   job pausado hasta resolverlo; no reactivar trabajos a mano.

```sql
-- Debe dar 0 después de la transición; no expone cuerpos ni destinatarios.
select count(*) as avisos_mp_obsoletos_activos
from public.demo_email_outbox e
join public.orders o on o.id=e.order_id
where o.demo_payment='mercado_pago' and e.event<>'payment_approved'
  and e.state in ('queued','sending') and e.provider_id is null;

select e.event,e.state,count(*)
from public.demo_email_outbox e
join public.orders o on o.id=e.order_id
where o.demo_payment='mercado_pago'
group by e.event,e.state order by e.event,e.state;

select proname,prosecdef,proconfig,proacl
from pg_proc where oid in (
 'public.demo_email_eligible(uuid,text)'::regprocedure,
 'public.demo_email_maintenance()'::regprocedure,
 'public.demo_email_begin(uuid,uuid)'::regprocedure);
-- Contrastar con las firmas/permisos previos; sin nuevos grants públicos.
```

La prueba sandbox de entrega posterior necesita autorización aparte: no se realizó
ninguna compra ni envío real durante este trabajo. Cuando se autorice, observar
una aprobación verificada, un único job y una única identidad Resend. Los
webhooks repetidos no deben crear otro job. No marcar pagos ni reencolar desde
SQL para probar este cambio.

## Reversión

Con el worker pausado/drenado, revisar
`supabase/operations/mp-approved-email-only-rollback.sql`: exige huellas exactas
y restaura las tres funciones originales. Restaurar también el bundle anterior
de `demo-email-worker` (incluida la corrección de #19). No revertir pagos ni
migraciones anteriores. La restauración vuelve a permitir las reglas anteriores
de notificación y debe aprobarse expresamente.

No se deshacen automáticamente las supresiones: no se reencolan avisos antiguos,
no se borran IDs de idempotencia y no se alteran mensajes ya enviados. No intentar
reconstruirlos con una nueva clave. La retención normal permanece igual.

## Validación

Las pruebas utilizan PostgreSQL aislado y respuestas HTTP simuladas; no usan
credenciales ni servicios reales. Las suites históricas de SQL siguen probando
el contrato anterior, mientras la nueva suite instala toda la cadena actual y
comprueba el incremento. Los tests genéricos de transporte del worker ejercitan
pedido recibido con transferencia, porque ese evento ya no corresponde a MP.
Ninguna prueba se desactiva para mantener expectativas antiguas de Mercado Pago.

Resultados ejecutados en esta revisión:

- `npm run check`: **989 pruebas / 58 archivos**, lint, TypeScript Edge/frontend
  y build aprobados. La nueva suite de política aporta 13 casos; se mantienen
  todos los tests previos, incluida la regresión HTTP 204 de #19.
- `VANTA_TEST_PG_CONTAINER=… npm run test:emails:postgres`: **17 escenarios
  PostgreSQL 17 nativo local** aprobados, con carreras, cuotas, autorización,
  conservación de mensajes aceptados, supresión de reintentos congelados y
  reversión. Contenedor sin red ni puertos, eliminado al terminar.
- `git diff --check` aprobado. Sin cambios de dependencias ni servicios reales.
- No se repitieron pruebas de navegador: no cambió el frontend. El checkout,
  administración y pagos siguen cubiertos por las pruebas unitarias/integración
  existentes ejecutadas; la entrega real con Resend queda pendiente de activación
  manual autorizada y no se afirma haberla probado aquí.
