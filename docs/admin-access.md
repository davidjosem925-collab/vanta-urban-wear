# Acceso administrativo: dispositivos y recuperación

Esta entrega no requiere migraciones. No modifica RLS, RPC, `is_admin()`, roles,
reservas, vencimientos, catálogo ni la Edge Function. Las opciones de dispositivo
están desactivadas por defecto. No se ha configurado el proyecto remoto ni se
realizaron inicios de sesión o envíos de correo allí. Solo se leyeron metadatos
públicos mediante GET `/auth/v1/health` y `/auth/v1/settings`: el 21/10/2026
respondieron HTTP 200, Auth `v2.197.0`, `passkeys_enabled=false` y correo
habilitado. Estos datos no certifican SMTP ni la disponibilidad del factor experimental.

## Resultado de la auditoría

El panel usa un cliente Auth independiente del cliente anónimo de la tienda.
Comprueba el usuario con Auth, la membresía activa y el nivel de sesión; ahora
comprueba también `is_admin()` en el servidor antes de mostrar el espacio privado.
Las RPC y las políticas siguen exigiendo administrador activo **y AAL2**. No se
aceptan roles desde `user_metadata`, claves privadas ni autorizaciones del navegador.

Hay **dos credenciales diferentes**, aunque ambas usen la huella, rostro o PIN:

| Mecanismo | API | Resultado observado en Auth local | Acceso administrativo |
| --- | --- | --- | --- |
| Passkey de ingreso | `auth.signInWithPasskey()` | AAL1 | Denegado por `is_admin()` |
| Factor de dispositivo | `auth.mfa.webauthn.challenge/verify` | AAL2 tras verificar | Permitido solo con membresía activa |
| Contraseña y aplicación de respaldo | Auth password + MFA actual | AAL2 tras verificar | Se conserva |

Una passkey primaria **no sustituye por sí sola** el segundo paso del panel.
Si el servicio habilita el factor experimental de dispositivo, se puede ingresar
con contraseña + dispositivo, sin usar la aplicación autenticadora diariamente.
La modalidad recomendada es contraseña + factor de dispositivo. El panel impide
combinar credenciales primarias y de segundo paso en la misma cuenta: Auth usa
el mismo RP/identidad con almacenes separados y algunos autenticadores reemplazan
la credencial residente anterior al registrar la otra clase. La prueba local
detectó ese reemplazo real en Chromium; no se declara compatible esa combinación.
Para cambiar de modalidad, comprobar el respaldo y quitar primero las credenciales
de la modalidad anterior desde una sesión autorizada.
El primer registro se hace desde una sesión administrativa ya autorizada. Se
conserva el autenticador existente como respaldo; la interfaz no permite quitar
un factor de dispositivo sin ese respaldo verificado. No hay reconocimiento
facial de la web ni permiso de cámara. Las credenciales sincronizadas no son una
lista exacta de equipos físicos o sesiones abiertas.

### Versiones y evidencia

- La documentación oficial indica `supabase-js >= 2.105.0` para passkeys y las
  describe como experimentales. El proyecto ya resolvía **2.118.0**; se eleva el
  mínimo declarado a esa versión porque también usamos el identificador de flujo
  de recuperación. No se actualiza el árbol de dependencias instalado.
- En auth-js 2.118.0 `experimental.passkey` es una opción obsoleta e ignorada:
  el SDK expone el API por defecto. Se deja explícita para documentar la intención;
  eso **no habilita** el servicio en Supabase ni el botón de VANTA.
- El servidor Auth incorporó passkeys en 2.188.0 y controles de AAL para registro
  y eliminación en 2.190.0. No habilitar esta integración en un servidor anterior
  a 2.190.0; utilizar una versión soportada y corregida por Supabase. La prueba
  nueva usa **GoTrue 2.197.0**, coincide con la versión informada por el endpoint público del proyecto,
  pero no acredita su configuración experimental.
- Se inspeccionó el código oficial de Auth, revisión
  `c3348e8f1cb31454e9783e4eb9eab1e71ad9652f`: `PasskeyLogin` no eleva el nivel;
  `MFAWebAuthn` sí. El RP y los orígenes son configuración del servidor, no una
  autorización que pueda cambiar el cliente con un parámetro.

Fuentes oficiales:
[passkeys](https://supabase.com/docs/guides/auth/passkeys),
[referencia MFA](https://supabase.com/docs/reference/javascript/auth-mfa),
[SDK MFA WebAuthn](https://github.com/supabase/supabase-js/blob/v2.118.0/packages/core/auth-js/src/lib/webauthn.ts),
[clasificación de AAL](https://github.com/supabase/auth/blob/c3348e8f1cb31454e9783e4eb9eab1e71ad9652f/internal/models/amr.go),
[changelog Auth](https://github.com/supabase/auth/blob/c3348e8f1cb31454e9783e4eb9eab1e71ad9652f/CHANGELOG.md).

## Activación manual, sin arriesgar el acceso actual

1. Mantener una sesión de respaldo y comprobar contraseña + autenticador actual
   en otra ventana. No borrar factores, usuarios ni credenciales existentes.
2. Confirmar con Supabase la versión soportada del servicio Auth y disponibilidad
   de **ambos** mecanismos. Authentication → Passkeys habilita el ingreso primario;
   **no asumir que habilita MFA WebAuthn**. La referencia web pública de MFA todavía
   destaca aplicación/telefono; el segundo factor WebAuthn es experimental.
   Si el Dashboard/API oficialmente soportado del proyecto no ofrece su activación,
   solicitar confirmación a Supabase. No agregar secretos arbitrarios esperando
   que reconfiguren Auth alojado y no tocar el esquema `auth` manualmente.
3. Elegir primero el dominio HTTPS estable aprobado para VANTA. En Authentication
   → Passkeys configurar nombre VANTA, RP ID (solo hostname, sin protocolo,
   puerto o ruta) y orígenes HTTPS exactos aprobados. Usar el mismo RP para ambos
   mecanismos. No usar un dominio temporal de preview como RP de producción.
   Cambiar el RP inutiliza las credenciales anteriores; agregar un subdominio
   exige que sea compatible con el RP y esté en la lista del servidor.
4. Solo si está disponible y aprobado: habilitar registro y verificación del
   segundo factor de dispositivo mediante la configuración soportada del servicio.
   En GoTrue **autohospedado** los nombres oficiales son
   `GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED` y
   `GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED`, junto con
   `GOTRUE_WEBAUTHN_RP_ID`, `GOTRUE_WEBAUTHN_RP_DISPLAY_NAME`,
   `GOTRUE_WEBAUTHN_RP_ORIGINS`. Son configuración del servidor de pruebas, **no
   secretos de Edge Functions ni instrucciones para modificar el proyecto alojado**.
5. Configurar las variables públicas de construcción, sin cambiar credenciales:
   `VITE_ADMIN_PASSKEYS_ENABLED=true` para ingreso primario;
   `VITE_ADMIN_DEVICE_MFA_ENABLED=true` solo cuando el segundo mecanismo esté
   disponible; `VITE_ADMIN_RP_ID` con el RP aprobado. Recompilar manualmente.
   Activarlas no concede permisos ni sustituye la configuración de Auth.
   Mantener habilitada la API de passkeys en el servidor para inspeccionar
   credenciales anteriores, aunque se elija solo segunda verificación en VANTA.
   Si no se pueden consultar, el registro se bloquea para evitar reemplazarlas.
6. Ingresar con el respaldo, abrir **Seguridad del acceso → Administrar
   dispositivos**, registrar la segunda verificación (recomendado), o elegir ingreso primario
   y conservar el código como segundo paso. No registrar ambas modalidades.
   Probar en otra ventana antes de cerrar el respaldo. El sistema operativo ofrece
   el dispositivo local; no hace falta escanear un QR para estos registros.
7. Verificar con un administrador de prueba: contraseña + dispositivo alcanza el
   panel; passkey primaria sola queda en segunda verificación; usuario sin perfil
   o desactivado no entra. Probar el equipo y teléfono físicos que se utilizarán.

**Alternativa segura si el servicio no admite el segundo factor experimental:**
activar solo el ingreso primario opcional o dejar ambos interruptores en `false`;
conservar contraseña + autenticador. En ese caso la passkey no elimina el uso
cotidiano del código. No hay bypass, AAL2 inventado ni modificación de RLS.

En desarrollo usar `localhost` como RP, un origen `http://localhost:PUERTO`
permitido por el servicio aislado y siempre el mismo hostname. HTTPS es obligatorio
fuera de loopback. Algunos navegadores no admiten RP de direcciones IP aunque la
página sea un contexto seguro; preferir `localhost`. Los emuladores Chromium no
sustituyen pruebas en Safari/iOS, Android o Windows Hello. No se garantiza la
misma experiencia en todos los gestores de credenciales.

## Correo y recuperación: configuración manual

1. En Authentication → URL Configuration conservar el Site URL aprobado. Agregar
   únicamente el origen y ruta reales de la aplicación. El callback es:
   `https://DOMINIO_APROBADO/?admin_recovery=1#/admin`.
   Para el identificador generado por el SDK, permitir también el patrón específico
   `https://DOMINIO_APROBADO/?admin_recovery=1&sb_flow_id=*#/admin`.
   Reemplazar el marcador con el dominio elegido; no copiarlo literalmente.
   En desarrollo agregar las dos entradas equivalentes de `http://localhost:5173`
   (o el puerto real). No usar comodines de hostname ni redirecciones abiertas.
2. Configurar el proveedor SMTP en Authentication → SMTP Settings, con credenciales
   únicamente en Supabase. Validar remitente/dominio con el proveedor, SPF/DKIM y
   entrega a la cuenta administrativa. El servicio de correo predeterminado tiene
   restricciones de destinatarios y límites; no asumir entrega general.
3. En la plantilla **Reset password** mantener el enlace `{{ .ConfirmationURL }}`.
   No reemplazarlo por el inicio ni por una URL armada que pierda `redirect_to`,
   código o identificador. Desactivar seguimiento/reemplazo automático de enlaces
   del proveedor para estos correos; los escáneres pueden consumir enlaces de un uso.
4. Revisar expiración configurada de enlaces, límites de correo y políticas de
   contraseña/reauthenticación. No deshabilitar verificaciones adicionales para que
   una prueba pase. Si se exige reautenticación especial, mantenerla y comprobar
   el flujo con esa configuración antes de activar en producción.
5. Solicitar un enlace desde **Recuperar contraseña** y abrirlo en el **mismo
   navegador y origen** (puede ser otra pestaña). En el teléfono, usar el mismo
   navegador que inició la solicitud, no el navegador embebido del correo. El
   verificador PKCE vive en localStorage; la sesión administrativa, en sessionStorage.
   No prometer recuperación entre navegadores/dispositivos: iniciar allí una
   solicitud nueva. Los flujos simultáneos tienen verificadores separados.
6. Tras abrir el enlace, completar la segunda verificación, elegir contraseña
   nueva y confirmarla. Se limpia el callback; la intención de recuperación
   sobrevive a recargar en esa pestaña, pero no autoriza nada. Solo una sesión
   administrativa verificada muestra el formulario. Al guardar se cierra la sesión
   local y se vuelve al acceso. Enlaces inválidos/vencidos no permiten saltar MFA.
7. Probar una vez el ingreso con la nueva contraseña, el rechazo de la anterior,
   un enlace usado/vencido y un usuario no administrador. No compartir enlaces,
   tokens, QR ni capturas de datos personales en logs o incidencias.

El cambio de contraseña de GoTrue invalida otras sesiones renovables; la aplicación
cierra también la sesión local. JWT ya emitidos pueden seguir válidos hasta su
expiración según el servicio. Ante compromiso real, desactivar inmediatamente el
perfil administrativo, revocar sesiones desde Dashboard y seguir el procedimiento
de incidente de `stage-6-admin.md`; no reactivar la identidad mientras tokens
anteriores puedan autorizarla. Perder también el segundo factor requiere
recuperación confiable por el propietario en Dashboard, nunca solo un enlace email.

Fuentes: [recuperación](https://supabase.com/docs/guides/auth/passwords),
[redirecciones](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[plantillas](https://supabase.com/docs/guides/auth/auth-email-templates).

## Verificación reproducible

- `npm ci`, `npm run check`, `npm audit`.
- `npm run test:e2e`: incluye acceso y regresiones, 1440/820/375/393/320 px.
  Las respuestas Supabase de navegador están simuladas. La ceremonia de registro
  y firma usa el autenticador virtual de Chromium, no biometría física.
- `npm run test:e2e:orders`: checkout y pedidos demo simulados.
- `npm run test:admin:auth`: GoTrue 2.177.0 + PostgREST + PostgreSQL locales reales,
  contraseña, segundo paso existente, JWT firmados, RLS/RPC, desactivación.
- `npm run test:admin:passkeys`: servicios locales reales GoTrue 2.197.0,
  registro y firma verificados criptográficamente, AAL1 rechazado por `is_admin()`,
  elevación AAL2 y eliminación de credenciales. Requiere Docker local y Chromium
  instalado por `npx playwright install chromium`. Opcional
  `CHROMIUM_EXECUTABLE_PATH` para un Chromium del sistema. No acepta URL remota.
- `npm run test:orders:postgres` con el contenedor PostgreSQL desechable descrito
  en la documentación de etapa 5. No acepta DSN remoto.

Las pruebas aisladas **no certifican** la configuración alojada, entrega SMTP,
HTTPS/RP definitivo, Safari/iPhone ni Windows Hello físico. Esas comprobaciones
manuales quedan pendientes de la activación autorizada. CI conserva los controles
anteriores y agrega la integración local de passkeys.

## Reversión

Desactivar ambos interruptores públicos y recompilar restaura contraseña + código;
no cambia permisos, sesiones ni datos de negocio. No cambiar RP ID ni borrar
credenciales para revertir la interfaz. Conservar temporalmente el factor de
servidor verificable y un acceso de respaldo; antes de deshabilitarlo en Auth,
comprobar que todos los administradores conservan el autenticador alternativo.
El correo/PKCE es independiente y puede mantenerse. No revertir migraciones de
seguridad ni rebajar `is_admin()`. El riesgo experimental se limita con activación
separada, respaldo y pruebas reales del servicio antes de habilitarlo a usuarios.

## Resultados de la implementación inicial (eb0371f)

- `npm run check`: lint, TypeScript Edge, **364 pruebas / 34 archivos**
  (frontend, handler, SQL/PGlite y seguridad) y TypeScript frontend/build aprobados.
- `npm run test:e2e`: **180/180**, cinco tamaños, Supabase simulado y
  autenticador virtual nativo; incluye tienda, carrito, checkout y administración.
- `npm run test:admin:auth` y `npm run test:admin:passkeys`: aprobados con
  servicios locales reales; la segunda prueba también demuestra el rechazo de
  eliminación de credenciales desde AAL1 y la revocación efectiva del administrador.
- PostgreSQL 17: **11/11** escenarios, incluidos concurrencia, reservas,
  idempotencia, vencimiento y liberación de stock.
- Deno/Siteverify: **3/3**, servidor HTTP local, sin Cloudflare remoto.
- `npm run images:check` y `npm run demo:check`: aprobados, 36 WebP intactas,
  12 fotos y 96 variantes; sin acceso remoto.
- `npm audit`: **0 vulnerabilidades**.

`npm run test:e2e:orders`: **30/30** aprobadas en los cinco tamaños. Total de
pruebas de navegador: **210**. Los resultados anteriores son ejecuciones locales;
GitHub Actions vuelve a ejecutarlas en la PR y publica allí su estado.

## Revisión local antes de activar el servicio

`npm ci` y `npm run dev`; abrir `http://localhost:5173/#/admin` para revisar
el acceso y la recuperación integrados. Con los interruptores predeterminados no
se ofrece una opción de dispositivo que el servicio aún no admite. Para revisar
las nuevas pantallas con datos ficticios y sin escribir en el proyecto real:
`npm run test:e2e -- e2e/admin-access.spec.ts --project=desktop --headed`.
Playwright configura automáticamente el proyecto simulado y las opciones de
interfaz. Para la integración criptográfica, usar el comando de contenedores
locales descrito arriba. Ninguna prueba automatizada necesita credenciales de
un administrador real.

La revisión posterior de compatibilidad alojada, prioridad del dispositivo y
foco accesible se documenta en [admin-access-final-review.md](admin-access-final-review.md),
con sus resultados separados de esta validación inicial.

Para el problema reproducido de interrupciones al verificar el código, métodos
no visibles y elección de autenticadores, consultar [admin-mfa-session-fix.md](admin-mfa-session-fix.md).
Incluye pruebas de renovación/pestañas y los pasos específicos para computadora
 y celular sin modificar la configuración remota automáticamente.
