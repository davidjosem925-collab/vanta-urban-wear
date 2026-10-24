# Checkout Pro: URL con `pref_id` — incremento sobre la PR #17

## Causa y alcance

La evidencia de solo lectura aportada por el propietario contiene una única orden
sandbox `created`, identificador `ORDTST…` y URL HTTPS oficial con `order_id` y
`pref_id`. El diagnóstico `dependency=create / validation=checkout_url` muestra
que el parser alojado rechaza la URL antes de vincularla. El código de la #17
exigía igualdad literal con una URL que solo tenía `order_id`; frontend y RPC SQL
repetían esa restricción. Es una incompatibilidad comprobada del contrato local.
No se consultó al proveedor durante este trabajo; el contenido exacto de la
respuesta POST y el funcionamiento alojado posterior siguen pendientes de
validación autorizada. No se incorpora la referencia real a fixtures o logs.

## Política estricta

- Único destino: `https://www.mercadopago.com.ar/checkout/v1/redirect`.
- Exactamente un `order_id=ORDTST[A-Z0-9]{10,60}`, que debe coincidir con el ID
  de la orden validada en el backend y con `p_resource` en SQL.
- Opcionalmente un `pref_id`, en cualquier orden de parámetros. Se admite un
  token opaco de **1–200 caracteres ASCII alfanuméricos, guion o guion bajo**.
  Es un límite de compatibilidad local deliberado: no se interpreta como UUID,
  no se deriva del vendedor y no es una firma, autorización ni prueba de pago.
  La evidencia recibida no especifica el formato exacto de ese token; si el
  proveedor entrega otro alfabeto o longitud, sigue bloqueado hasta revisarlo.
- Sin parámetros adicionales/duplicados, campos vacíos, `%`/codificaciones,
  fragmentos (incluso vacíos), credenciales, puertos explícitos (incluido `:443`),
  espacios, controles, rutas normalizadas o hosts alternativos.
- Se retorna/almacena **la cadena original íntegra**; no se elimina `pref_id`,
  reordena la consulta ni se fabrica una URL.

`checkout-url.ts` es un módulo público puro compartido por Edge y frontend; no
importa configuración, clientes, credenciales ni código de runtime servidor.
El frontend verifica el destino antes de navegar. La comparación con la identidad
remota ocurre en el backend y SQL; no se inventa un identificador adicional en el
DTO público. La URL por sí sola nunca confirma una compra.

`provider.ts` y `handlers.ts` no necesitan cambios de producción: POST, GET,
búsqueda+GET y la hidratación de URL usan el mismo parser existente. La prueba
integra esos recorridos con SQL actualizado y el DTO del navegador. Una respuesta
POST maliciosa sigue fallando; una recuperación posterior solo puede vincular una
respuesta GET completamente válida. No hay un POST nuevo como fallback.

Se conservan dinero desconocido `NULL/unreported`, estados permitidos, evidencia
explícita e importe exacto para `processed/accredited`, vendedor/app/referencia,
ARS/total/ítems, URLs, capacidades, límites, idempotencia, stock y vencimiento.
No se cambian RLS, permisos, columnas, filas, flags ni credenciales.

Referencia oficial del campo `checkout_url` y recuperación de órdenes:

- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/get-order/get

La política no toma ejemplos incompletos de esas páginas como autorización de
hosts arbitrarios ni como garantía criptográfica sobre `pref_id`.

## Activación manual — no ejecutada

1. Revisar y aprobar el incremento completo sobre #17. Deben estar aplicadas
   `202610240001_mp_payment_evidence.sql` y
   `202610240002_mp_created_without_detail.sql`. **No editarlas ni reaplicarlas.**
2. Como propietario SQL, comprobar de solo lectura:

   ```sql
   select md5(replace(prosrc, E'\r\n', E'\n')) as rpc_fingerprint,
          prosecdef, proconfig, proacl
   from pg_proc
   where oid = 'public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure;
   ```

   La huella previa requerida es `23838ac0ba7c9b53bd60046aef7b7be0` (002).
   Si difiere, detenerse y comparar la definición; no quitar la guarda.
3. Tras autorización explícita, ejecutar **solo**
   `supabase/migrations/202610240003_mp_checkout_pref_id.sql` completo en SQL
   Editor, incluidos `begin` y `commit`. Es una sustitución incremental de la
   misma RPC con guarda de versión; no modifica datos ni grants. Conservar una
   copia privada de la definición previa para revisión.
4. Comprobar la huella posterior `04ff17f8efe99347dcba658b82823a65`, seguridad
   y permisos con las consultas de abajo.
5. Tras autorización de despliegue, actualizar **mp-checkout, mp-webhook y
   mp-reconcile**, incluyendo el nuevo módulo compartido, usando la configuración
   actual de `supabase/config.toml`. Publicar también el build del frontend con
   la validación nueva antes de probar la redirección. No cambiar secretos,
   flags, gateway, modo test ni habilitar producción. SQL primero.
6. Desde la sesión original del comprador, usar **recuperar/consultar** la
   operación existente: búsqueda+GET si aún no está vinculada. No crear otra
   compra ni regenerar su capacidad. Si ya venció, no se reabre ni se devuelve
   una URL de pago. Si falta la sesión/capacidad, no inventarla ni modificar filas.
7. Cuando se autorice la validación alojada, comprobar: vínculo único con
   `ORDTST…`, estado pendiente sin acreditación, evidencia monetaria desconocida
   conservada como NULL y una sola reserva; URL original completa aceptada por
   frontend. La prueba de apertura no equivale a aprobación; no pagar ni crear
   transacciones como parte del despliegue de este incremento.

Comprobaciones adicionales de solo lectura:

```sql
select prosecdef, proconfig,
       has_function_privilege('anon', oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', oid, 'execute') as user_execute,
       has_function_privilege('service_role', oid, 'execute') as service_execute
from pg_proc
where oid = 'public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure;
-- true; search_path vacío; false; false; true.

select count(*) as urls_con_pref_id
from public.payments
where mp_checkout_url like '%pref_id=%';
-- Solo conteo; no publicar URLs ni referencias/capacidades.
```

## Reversión

`supabase/operations/mp-checkout-pref-id-rollback.sql` exige propietario, huella
exacta de la 003 y ausencia de URLs almacenadas con `pref_id`. Restaura exactamente
la RPC de 002, sin borrar filas, columnas, evidencia financiera ni rutas.

Si devuelve `PREF_ID_URL_PRESENT`, **no borrar ni recortar URLs para forzarlo**:
conservar el contrato compatible y revisar la situación de las operaciones.
Volver a desplegar frontend/backend de #17 también rechazaría esas URLs; no
hacerlo mientras puedan necesitarse. Ante un incidente, suspender nuevas
iniciaciones solo mediante el procedimiento operativo previamente autorizado y
mantener conciliación compatible para operaciones pendientes. Revertir 003 antes
de considerar 002/001; sus propias guardas siguen vigentes. No reaplicar 001/002
sobre 003 porque sobrescribirían el contrato y ocultarían incompatibilidades.

## Verificación local

Los fixtures son sintéticos. No se usan credenciales reales ni se llama a
Mercado Pago/Supabase/Resend. Se verifica el mismo conjunto de URLs válidas y
maliciosas en backend, navegador y PostgreSQL aislado. Los resultados finales se
registran en la descripción de la PR. La recepción real POST/GET, despliegue Edge
y redirección sandbox alojados requieren activación manual y no se presentan
como pruebas ejecutadas.

Resultados ejecutados:

- `npm run check`: **956 pruebas / 56 archivos**, lint, TypeScript frontend y
  Edge, y build aprobados. Son 77 casos nuevos sobre la #17.
- `VANTA_TEST_PG_CONTAINER=… npm run test:payments:postgres`: **15 escenarios
  PostgreSQL 17 nativo local** aprobados. Contenedor sin red ni puertos y
  eliminado al terminar; las carreras de stock se verificaron con 003 activa.
- `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:payments --
  --project=desktop --project=mobile-393`: **12 aprobadas** en 1440 y 393 px,
  con destinos/proveedores interceptados; sin transacciones reales.
- `npm run lint` repetido tras incorporar las pruebas E2E: aprobado.
- `git diff --check`: aprobado. No se alteraron las migraciones 001/002.

La primera corrida E2E tuvo 11 aprobadas y una falla móvil causada por una
recarga de Vite durante una edición de formato: el formulario en memoria se
reinició mientras se comprobaba la posición del aviso. La repetición completa,
sin editar archivos durante la ejecución y sin omitir pruebas ni usar reintentos,
terminó 12/12. No se modificó la lógica del formulario ni sus validaciones.
