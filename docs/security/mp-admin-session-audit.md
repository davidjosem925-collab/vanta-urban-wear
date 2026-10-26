# Auditoría de autorización de Mercado Pago — VANTA Urban Wear

Fecha: 26 de octubre de 2026. Repositorio: davidjosem925-collab/vanta-urban-wear.
Base revisada: `chore/public-demo-final`, commit `32dde5840e2309f58d19065b5f3fcf9e99bb70c1`.
Se verificó que sus únicos cambios respecto de `1cdc636` son los seis archivos indicados. El árbol local reconstruido coincide con el árbol remoto `eff80b34dd96ad5280ac4da40caa19b410604035`.

## Dictamen

No recomendar desplegar `32dde58` como solución completa al objetivo solicitado: el frontend de pagos no envía JWT y la revocación depende de una migración opcional de acceso por email. La corrección propuesta cierra esas dos brechas sin cambiar la lógica financiera. Su activación debe seguir la secuencia indicada abajo y verificarse en el entorno destino. No equivale a una autorización para cobros reales: se conserva exclusivamente el modo test.

## Hallazgos y resolución

1. **Revocación incompleta en el modo AAL2 anterior — severidad media.** `is_admin()` del panel verifica AAL2 y membresía activa, pero no consulta `auth.sessions`. Un JWT firmado y aún vigente de una sesión eliminada podía seguir autorizando pagos hasta su expiración. La migración opcional de email sí consulta sesiones, pero no es un requisito del checkout original. Se agrega `mp_checkout_is_admin()`: exige rol `authenticated`, la política vigente de `is_admin()`, sesión con el mismo `session_id` y propietario, vigencia de `not_after`, email confirmado y usuario no bloqueado. Conserva la política AAL2 o email existente, incluido su límite de siete días cuando corresponde. La revocación aquí significa eliminar/revocar la sesión en Supabase; no se implementa una lista independiente de JWT individuales.

2. **Frontend sin JWT — problema funcional.** `requestPayment()` solo enviaba `apikey`; un administrador tampoco podía pasar el nuevo control. Se permite suministrar un access token en Authorization y se agrega `requestAdminPayment()` en el módulo administrativo, que obtiene la sesión desde su cliente separado. No se lee el almacenamiento administrativo desde el storefront. No se agregan botones ni un flujo que revele capabilities de pedidos: el adaptador sigue necesitando la capability original. El panel existente conserva sus operaciones administrativas habituales.

3. **Clave service role como apikey — endurecimiento, sin elevación demostrada.** En una petición REST estándar de Supabase, PostgREST usa el JWT explícito de Authorization para validar firma/expiración y establecer los claims/rol; `apikey` no debe sustituir ese bearer. La combinación original no demuestra por sí misma que `is_admin()` se ejecute con claims service role. Se elimina esa ambigüedad y el uso innecesario de una clave privada en el guard: ahora usa `SUPABASE_ANON_KEY` como apikey y el JWT recibido como Authorization. El cliente RPC privilegiado se reserva para los pagos después del control.

4. **Contrato y errores.** Solo HTTP exitoso con JSON escalar `true` autoriza. Ya no se acepta `{v:true}` ni se propagan códigos arbitrarios del upstream como autorización. Sin bearer o con tamaño excesivo se responde 401; JWT rechazado con 401 se devuelve 401; denegación de política, respuesta inesperada u otro error HTTP se devuelve 403. Un fallo de red también cierra el acceso. Ningún error habilita un fallback a credenciales privilegiadas.

## Revisión de los nueve puntos solicitados

| Punto | Resultado |
| --- | --- |
| `requireAdminSession()` | Cierra el acceso por defecto; exige el nuevo RPC de sesión y respuesta estricta. |
| apikey y Authorization | Guard con clave pública anon y bearer del visitante; sin reemplazo por service role. |
| Identidad y contexto | PostgREST valida el JWT; `auth.uid()`/`auth.jwt()` conservan claims de usuario dentro del SECURITY DEFINER. El definer solo habilita lectura controlada de Auth, con `search_path=''`. Solo `authenticated` puede ejecutar el guard. |
| Negativos | Sin token, sobredimensionado, JWT inválido/vencido rechazado por upstream, sesión eliminada/vencida/ajena, no miembro, inactivo, bloqueado y roles no autorizados. |
| Orden de autorización | Guard antes de `demo_rate_limit`, configuración, prepare/claim/apply y llamadas al proveedor, tanto create como recover. Validación de formato, origen y feature flag pueden rechazar antes, sin efectos financieros. |
| Frontend | Adaptador administrativo con access token de su namespace; solo configuración pública en navegador. No service role, access token de MP ni secretos de webhook/worker. |
| Webhook y conciliación | Mantienen HMAC y bearer privado respectivamente; no pasan por el guard administrativo. La clave anon solo se exige al entrar al checkout. |
| Pedidos públicos | `demo-orders` continúa con challenge, capability, límites e idempotencia; no importa el guard ni necesita JWT administrativo. Sus pagos simulados no llaman a MP. |
| Controles reales | La autorización ocurre en backend. VITE y botones son presentación; CORS/origin no sustituyen el JWT. Las RPC financieras conservan permisos exclusivos de service role. |

## Restricciones preservadas

No se alteran `MP_MODE=test`, verificación autenticada del vendedor `test_user` de Argentina, seller/application congelados, límites de intentos y tasas, clave de idempotencia, reservas, montos, moneda, conciliación ni evidencia financiera. La recuperación sigue sin crear nuevas órdenes en el proveedor. No se modifican las funciones `is_admin()` ni los permisos de operaciones existentes.

## Validación

- `npm run check`: **PASS**, código de salida 0, con la configuración original del repositorio: lint sin advertencias, typecheck de Edge, **63 archivos / 1101 pruebas aprobadas**, typecheck del frontend y build de producción.
- Pruebas focalizadas del handler de autorización y adaptador administrativo: **21/21**.
- Pruebas focalizadas de handlers de pagos, límites compartidos y SQL de sesiones: **97/97**, con PGlite local. Incluyen webhook, worker, idempotencia y recuperación en las pruebas existentes.
- `git diff --check`: **PASS**.
- Se hizo además una corrida completa con pool threads temporal: 63 archivos / 1101 pruebas aprobadas. Se restauró la configuración y la corrida final normal también pasó; no se incluye ningún cambio a Vitest en la PR.
- No se ejecutaron las suites E2E ni PostgreSQL/Docker externas a `npm run check`. No se ejecutó `npm audit` como parte de esta auditoría focalizada.
- Registro completo de la corrida final adjunto como [npm-run-check.log](./npm-run-check.log).

Las respuestas de PostgREST a JWT inválidos/vencidos se simulan en pruebas del handler; las políticas de sesión/membresía se ejecutan en SQL real local con PGlite. No se probaron firma JWT ni configuración del gateway/JWKS contra el proyecto desplegado. Esta limitación requiere smoke tests de autorización en el destino antes de habilitar checkout.

## Activación posterior, fuera de esta auditoría

1. Revisar y aprobar la PR contra `chore/public-demo-final`. No requiere merge a main.
2. Un operador autorizado debe revisar y aplicar `202610260001_mp_admin_session.sql` en el destino, después de las migraciones del panel y con `auth.sessions` disponible. No hace falta activar el modo email; el guard conserva el modo de acceso ya elegido. La función solo devuelve un booleano y no expone tablas Auth.
3. Verificar que `SUPABASE_URL` y `SUPABASE_ANON_KEY` correspondan al mismo proyecto. La anon key es pública y normalmente está disponible en Edge; `SUPABASE_SERVICE_ROLE_KEY` debe seguir siendo exclusiva del backend para las RPC financieras. No copiar claves privadas a variables VITE. Verificar las configuraciones test y sus límites existentes; esta auditoría no las cambió.
4. Desplegar posteriormente la versión corregida de `mp-checkout` con su código compartido. El código anterior no usa la nueva función; aplicar solo SQL no corrige el handler anterior. Si el handler nuevo llega antes del SQL, falla cerrado. Webhook/reconcile conservan sus autoridades independientes; si se actualiza su bundle compartido, usar la misma revisión auditada.
5. Probar contra el destino con una referencia/capability inexistente y acción `recover`, sin pagos ni preparación de pagos nuevos: sin JWT, JWT manipulado, vencido, sesión revocada, no administrador y administrador vigente. Los rechazados no deben alcanzar RPC financieras/proveedor; el administrador puede llegar a `{found:false}`. Verificar logs sin tokens/PII y confirmar permisos del nuevo RPC. La revocación debe usar la misma sesión que emitió el JWT probado. No se realizaron estas operaciones durante la auditoría.
6. Mantener checkout público deshabilitado en presentación para la demo. Los visitantes pueden registrar pedidos simulados; solo un consumidor administrativo que tenga la capability original debe usar `requestAdminPayment()`. Conectar ese adaptador a un control administrativo futuro requiere conservar esa restricción; no se agregó un flujo nuevo de cobro en el panel. Cualquier activación de checkout debe seguir en test. Los flags públicos no otorgan permisos backend.

No se ejecutó SQL remoto, no se modificaron secretos, no se desplegaron funciones, no se cambió Vercel y no se realizaron pagos. Se utilizó la guía del plugin Cloud Environment para acceso y ejecución local: `skill://plugin_connector_1p_c5b7d5df5d7081918f2c4be5a633ed5d/cloud-environment-runtime/SKILL.md`.
