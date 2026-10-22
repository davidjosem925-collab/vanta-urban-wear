# Acceso administrativo por correo — propuesta de transición PR #8

## Decisión y estado

Esta es una reducción **explícita** del requisito de autorización administrativa:
se propone aceptar AAL1 para esta demo de portfolio. Un Magic Link no es MFA ni
se presenta como AAL2. La interfaz no basta: la migración incremental cambia
`is_admin()` del servidor. **No está aplicada al proyecto remoto.** El modo actual
contraseña + TOTP continúa por defecto (`VITE_ADMIN_EMAIL_ACCESS_ENABLED=false`).

La migración opcional `supabase/migrations/202610220001_admin_email_access.sql`:

- Conserva identidad JWT validada por Auth/PostgREST, exige rol authenticated,
  nivel AAL1/AAL2, correo confirmado, usuario no suspendido y perfil activo.
- Comprueba `session_id` contra `auth.sessions` del mismo usuario; sesión con
  `not_after` vencido o antigüedad de siete días ya no autoriza el panel. Solo
  **lee** Auth; no escribe, elimina factores ni altera su esquema/configuración.
- Mantiene SECURITY DEFINER con search_path vacío. La consulta de sesiones está
  [documentada por Supabase para rechazar JWT después del logout](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).
- Conserva RLS y RPC existentes: cada operación vuelve a comprobar `is_admin()`.
  No cambia creación/cancelación/expiración de pedidos, idempotencia ni reservas.
  Se revoca únicamente el permiso directo de escritura de categorías, que no
  tiene una operación de edición en este panel; productos/variantes/imágenes ya
  estaban limitados a RPC. No agrega altas públicas ni edición de admin_profiles.
- Expone `admin_access_mode()` solo a authenticated para detectar activación.
  Es una comprobación de compatibilidad de UI, nunca una autorización.

No modificar migraciones anteriores. Esta nueva migración tiene que **excluirse
expresamente de cualquier despliegue automático** hasta su aprobación. No ejecutar
`supabase db push` indiscriminadamente sobre esta rama.

## Riesgos y compensaciones

Aceptar AAL1 elimina la defensa de un segundo factor ante contraseña robada o
correo comprometido. El acceso al email pasa a ser una credencial administrativa:
proteger esa cuenta con MFA del proveedor, no reenviar enlaces, utilizar contraseña
única y gestor seguro. No usar la demo para información personal/pagos reales.
Las políticas siguen protegiendo frente a cuentas sin perfil, suspendidas,
perfiles desactivados y sesiones cerradas; no compensan una cuenta autorizada
comprometida. Para una tienda real, revisar esta decisión y volver a exigir MFA.

Las sesiones simplificadas persisten en localStorage con una clave separada
`vanta.admin.email.auth.v1`; las sesiones legadas mantienen sessionStorage y su
clave anterior. Esto permite reabrir el navegador, pero aumenta la exposición en
equipos compartidos y ante XSS. No existe cookie HttpOnly en esta SPA. No agregar
scripts/analíticas de terceros al acceso, mantener dependencias y HTTPS; cerrar
sesión al terminar en equipos compartidos. La tienda usa su cliente anónimo
independiente. Ni el flag ni localStorage conceden permisos.

La revocación del perfil o eliminación de la sesión por Auth bloquea **nuevas**
operaciones administrativas aunque el JWT todavía no haya vencido. Una operación
ya autorizada/en curso puede terminar. Datos ya descargados y URLs firmadas de
fotografías emitidas previamente no se revocan retroactivamente: las vistas
previas existentes duran hasta 900 segundos. Los límites de sesión configurados
por el proveedor pueden aplicarse al refrescar; la comprobación local adicional
de siete días no elimina sesiones en Auth. Reingresar crea una sesión nueva.

## Enlaces, PKCE y dispositivos diferentes

Se usa `auth.signInWithOtp({options:{shouldCreateUser:false}})` y
`auth.verifyOtp({token_hash,type})` oficiales. El proveedor verifica firma/uso,
expiración y consumo; VANTA no inventa una verificación por email.

Hay dos caminos, que no deben confundirse:

1. Callback PKCE `?admin_email=1&code=...&sb_flow_id=...#/admin` o recuperación
   equivalente: exige el verificador del navegador que solicitó el enlace.
   Abrirlo en otro navegador/teléfono no debe eludir esa condición; muestra un
   error y permite pedir otro enlace desde ese dispositivo.
2. Para uso entre dispositivos, la plantilla oficial basada en TokenHash lleva
   al callback de VANTA; se verifica por `verifyOtp` sin inventar/restaurar un
   verificador PKCE. El hash es una credencial bearer: quien recibe el enlace
   puede consumirlo. Es un tradeoff intencional para este flujo oficial, no una
   afirmación de que PKCE funciona entre dispositivos. El origen debe ser
   accesible desde el dispositivo receptor.

La URL se limpia antes de autenticar; el hash se mantiene solo en memoria hasta
la confirmación explícita «Continuar con este enlace». No se consume al cargar
la página: protege frente a previews simples de correo, pero no garantiza defensa
contra escáneres que ejecuten la interacción completa. Hay Referrer-Policy vía
meta `no-referrer`. No registrar query strings, tokens ni cuerpos de Auth en el
hosting/proxy/analíticas. No enviar enlaces a terceros. Si se recarga después de
limpiar la URL y antes de confirmar, reabrir el correo o solicitar otro enlace.

La recuperación usa `resetPasswordForEmail` y tipo recovery. Un enlace inválido,
vencido o usado no concede una sesión nueva. **Si la cuenta conserva un factor
MFA verificado, Supabase exige AAL2 para cambiar la contraseña:** el panel mantiene
ese paso sensible. No exige TOTP para el acceso administrativo cotidiano del
modo nuevo; no elimina factores para evitar la restricción del proveedor.
Al cambiar contraseña en el modo nuevo se cierran todas las sesiones mediante
Auth; si ese cierre no se confirma, se informa sin fingir éxito y se ocultan
los datos hasta revalidar o reintentar. Una sesión de recuperación AAL1 también
representa la identidad confirmada por correo y puede autorizar las RPC ordinarias
del modo nuevo; restringir la pantalla al cambio de contraseña no es una
restricción SQL adicional de esas RPC.

Si se pierde ese respaldo, recuperar la cuenta con el procedimiento autorizado
del proveedor; un email no elimina el factor perdido.

## Activación manual mínima (todavía pendiente en Supabase alojado)

1. Revisar esta decisión de riesgos y la migración completa. Comprobar el acceso
   actual contraseña + TOTP en otra ventana y guardar las plantillas/configuración
   actuales para revertir. Confirmar al menos un perfil administrativo activo;
   no crear perfiles desde React ni mediante signup.
2. Revisar Auth Email/SMTP: remitente verificado, entrega, SPF/DKIM, límites de
   Supabase y del proveedor, protección del buzón. Recomendación: enlaces de
   10–15 minutos y límite de reenvío; el valor real depende de configuración.
   Desactivar tracking/reemplazo de enlaces en el correo. No habilitar signup:
   todas las llamadas de VANTA llevan shouldCreateUser=false; antes de activar,
   comprobar o deshabilitar manualmente el registro público en Auth con aprobación.
3. Elegir un origen real aprobado, sin inventar dominio. Para esta prueba en PC,
   `http://localhost:5173` es el origen ya indicado por el propietario. Configurar
   manualmente Site URL **sin ruta ni barra final** y las redirecciones exactas:
   `http://localhost:5173/?admin_email=1#/admin` y
   `http://localhost:5173/?admin_recovery=1#/admin`, más la variante de recuperación
   con `&sb_flow_id=*` usada por el SDK. Para PKCE de ingreso agregar también su
   variante con flow ID si el proveedor la incluye. Sin comodines de hostname.
4. Para enlaces entre dispositivos usar las plantillas siguientes (SiteURL debe
   ser el origen aprobado, no un destino tomado libremente de una query). Para
   probar otro origen, aprobarlo/configurarlo manualmente primero; no copiar un
   dominio de ejemplo ni un preview temporal.

   Plantilla **Magic Link**:

   ```html
   <p>Solicitaste ingresar a VANTA.</p>
   <a
     href="{{ .SiteURL }}/?admin_email=1&amp;token_hash={{ .TokenHash }}&amp;type=email#/admin"
     >Ingresar a VANTA</a
   >
   <p>Si no lo solicitaste, ignorá este mensaje. No compartas el enlace.</p>
   ```

   Plantilla **Reset password**:

   ```html
   <p>Solicitaste recuperar tu acceso a VANTA.</p>
   <a
     href="{{ .SiteURL }}/?admin_recovery=1&amp;token_hash={{ .TokenHash }}&amp;type=recovery#/admin"
     >Recuperar acceso</a
   >
   <p>Si no lo solicitaste, ignorá este mensaje.</p>
   ```

   Fuentes: [Magic Link/TokenHash oficiales](https://supabase.com/docs/guides/auth/auth-email-passwordless),
   [plantillas](https://supabase.com/docs/guides/auth/auth-email-templates).
   El template afecta los correos del proyecto: revisar cualquier otro consumidor
   de Auth antes de cambiarlo. No modificar confirmación de registro ni invitaciones.

5. Ejecutar las comprobaciones SQL de abajo como propietario. Guardar los conteos.
   **Solo con aprobación**, aplicar una vez la nueva migración mediante SQL Editor
   o el proceso habitual controlado. No reaplicar las migraciones de etapas previas.
6. Activar localmente `VITE_ADMIN_EMAIL_ACCESS_ENABLED=true` en `.env.local` y
   reiniciar Vite. Los otros flags de dispositivos pueden quedar false para este
   modo. `npm ci`, `npm run dev -- --host localhost --port 5173 --strictPort`.
   El flag no activa la migración: si falta la función de modo, el panel bloquea.
7. Pedir un enlace, confirmar, comprobar productos/stock/pedidos sin modificar
   datos reales, recargar y reabrir el navegador. Probar contraseña alternativa,
   logout local/global y comprobar que el JWT anterior ya no autoriza RPC.
   No pegar JWT ni tokens en SQL Editor, capturas o chats: usar la sesión propia
   desde las herramientas de prueba con el SDK y registrar solo booleanos.
8. Probar una cuenta de prueba sin perfil y una cuenta administrativa desactivada
   **solo en un entorno aprobado**. En este desarrollo se hicieron esos cambios
   únicamente en bases locales descartables; no desactivar la cuenta real para
   una prueba sin autorización. Confirmar recuperación sensible con el respaldo.

En el celular, localhost apunta al teléfono, no a la PC. Magic Links no tienen
RP ID, pero necesitan un origen accesible y seguro. Las pruebas responsive no
prueban correo/OS físicos. Para una prueba real en teléfono, preparar HTTPS local
con certificado confiable y origen aprobado o esperar el dominio aprobado; no
exponer el panel por un túnel/hosting ni cambiar configuración automáticamente.

### Consultas de comprobación (solo lectura)

Antes y después, sin IDs de sesiones, tokens ni datos personales:

```sql
select count(*) filter (where active) as administradores_activos from public.admin_profiles;
select table_name,column_name from information_schema.columns
where table_schema='auth' and
 ((table_name='sessions' and column_name in ('id','user_id','created_at','not_after'))
 or (table_name='users' and column_name in ('id','email_confirmed_at','banned_until')))
order by table_name,column_name;
select 'products' as recurso,count(*) from public.products
union all select 'product_images',count(*) from public.product_images
union all select 'product_variants',count(*) from public.product_variants
union all select 'inventory',count(*) from public.inventory
union all select 'orders',count(*) from public.orders
union all select 'stock_reservations',count(*) from public.stock_reservations;
select sum(on_hand) as unidades,sum(reserved) as reservadas from public.inventory;
select pg_get_functiondef('public.is_admin()'::regprocedure);
select has_table_privilege('authenticated','public.products','INSERT') as producto_directo,
 has_table_privilege('authenticated','public.categories','UPDATE') as categoria_directa,
 has_table_privilege('authenticated','public.inventory','UPDATE') as inventario_directo;
```

Después de aprobar/aplicar, los tres permisos directos deben ser false.
`select public.admin_access_mode();` como propietario debe devolver email.
`is_admin()` en SQL Editor sin un JWT de usuario debe ser false: no falsificar
claims ni hacer esta comprobación como sustituto de una llamada autenticada real.
Comparar políticas/grants con el preflight de etapa 6: no se eliminan políticas.

## Reversión segura

1. Conservar los factores y comprobar que contraseña + TOTP sigue disponible.
2. Cambiar `VITE_ADMIN_EMAIL_ACCESS_ENABLED=false`, reiniciar/reconstruir y volver
   a la interfaz legada. El flag no retira los permisos AAL1 del servidor todavía.
3. **Con aprobación manual**, ejecutar
   `supabase/operations/admin-email-access-rollback.sql`: restaura el is_admin
   AAL2 anterior, el grant previo de categorías protegido por esa RLS y retira el
   handshake de email. No elimina datos, usuarios, factores ni sesiones.
4. Restaurar las plantillas previas y allowlist, sin romper enlaces válidos de
   otros consumidores. Si no se pueden coordinar los cambios, rollback SQL primero
   bloquea AAL1 de inmediato y la UI nueva fallará cerrada hasta restaurar el flag.
5. Verificar que AAL1 queda rechazado y AAL2 de un perfil activo sigue autorizado.
   Las sesiones persistentes de la demo tienen otra clave; no se confían ni se
   migran a la sesión legada. Usar Auth logout global si corresponde, con aprobación.

## Pruebas ejecutadas y cómo reproducirlas

| Comprobación                    | Resultado y alcance                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                 | **415/415**, 37 archivos; lint, TypeScript frontend/Edge y build aprobados                                                                                                                                                   |
| Navegador de tienda/modo legado | **220/220**, acceso, panel, carrito y checkout; tras los ajustes de errores/cierre se repitieron **20/20** casos afectados                                                                                                   |
| `npm run test:e2e:admin-email`  | **45/45**, modo nuevo, PKCE, token hash, persistencia, cierres local/global, fallo de cierre, recuperación y denegaciones                                                                                                    |
| `npm run test:e2e:orders`       | **30/30**, regresión de confirmación, recuperación, reintentos e idempotencia de pedidos demo                                                                                                                                |
| `npm run test:admin:email`      | GoTrue **2.197.0**, PostgreSQL y PostgREST **reales aislados**: enlace válido/vencido/reutilizado, AAL1 administrativo, RPC, no miembro, recuperación con/sin factores, revocación local/global/perfil, handshake y rollback |
| `npm run test:orders:postgres`  | **11 comprobaciones** reales PostgreSQL: concurrencia, idempotencia, vencimiento/liberación, permisos y compatibilidad de la etapa 6                                                                                         |
| `npm audit`                     | **0 vulnerabilidades**                                                                                                                                                                                                       |

Todos los navegadores anteriores son Chromium automatizado a **1440, 820, 375,
393 y 320 px**, con respuestas Supabase simuladas. No son pruebas del servicio
alojado, Safari/iOS físico o SMTP. Los enlaces de la integración real local se
generan por la API oficial administrativa de Auth, **solo con una credencial de
prueba del contenedor**: prueban verificación, expiración y uso único, no entrega
a un buzón. Esa credencial no entra en VANTA ni en la documentación de activación.
El cambio SQL se ejecutó exclusivamente en bases locales descartables.

Para repetir: Node >=22.12, `npm ci`, los comandos de la tabla y Chromium
instalado con Playwright. Las integraciones reales requieren Linux/WSL con Docker
local; el harness fija unix:///var/run/docker.sock y loopback, sin aceptar DSN
remoto. La suite PostgreSQL existente requiere `VANTA_TEST_PG_CONTAINER` apuntando
a un contenedor **local descartable**; crea su propia base de pruebas.

Para revisar la UI nueva sin activar Supabase remoto:
`npm run test:e2e:admin-email -- --project=desktop --debug` abre las fixtures en
Playwright Inspector. No habilitar el flag contra el proyecto real antes de la
migración aprobada. La suite del modo anterior mantiene el flag false de forma
explícita; CI ejecuta ambos modos por separado.

Pendientes reales: aprobar/aplicar manualmente la transición, SMTP/plantillas/
allowlist/registro deshabilitado y correo entregado en el proyecto alojado; login
real del propietario y prueba física móvil con origen accesible. El acceso directo
a Storage y URLs firmadas del proveedor real también debe comprobarse tras esa
aprobación; las políticas y el cliente se probaron localmente/simulados, sin
subidas o modificaciones remotas.

## Criterios para retirar TOTP del ingreso cotidiano

- Aprobación expresa de la reducción a AAL1 para portfolio y migración revisada.
- Administrador real confirmado entra por email y contraseña, sin challenge TOTP
  habitual; el servidor autoriza RPC/RLS y no solo la interfaz.
- Sin perfil/inactivo/sin sesión: SQL y Storage continúan bloqueados; cierre local
  y global invalidan la autorización de los JWT anteriores.
- Correo real entregado, enlace vencido/reutilizado rechazado, plantilla correcta,
  móvil físico con origen alcanzable y HTTPS fuera de loopback.
- Persistencia y recuperación probadas; se comprende que conservar un factor MFA
  puede mantenerlo obligatorio para cambiar contraseña. No eliminarlo para pasar
  una prueba ni prometer recuperación sin factor donde Auth no la permite.
- Conteos/datos existentes preservados; suites locales y navegador aprobadas.

La transición **no está activada ni aceptada en Supabase alojado** hasta completar
esos puntos. El desarrollo local puede estar verificado sin afirmar entrega SMTP
real, seguridad del buzón o compatibilidad física no ejecutada.
