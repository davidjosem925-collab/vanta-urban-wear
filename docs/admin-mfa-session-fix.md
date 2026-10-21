# PR #8: interrupciones de verificación y métodos disponibles

## Diagnóstico comprobado

Se ejecutó la regresión nueva contra el commit anterior `e307bb0`, en un checkout
local aislado. Falló después de `auth.refreshSession()`: desapareció el campo
«Código de seis dígitos». La misma prueba pasa con la corrección.

Causas de código:

1. El callback consideraba «misma cuenta» solo a quien ya tenía acceso AAL2.
   En AAL1, `authorizedUser` era null; cualquier renovación limpiaba factor/QR y
   mostraba loading, desmontando el formulario y perdiendo su entrada.
2. El cliente guarda sesiones por pestaña, pero el SDK usa BroadcastChannel para
   notificar eventos entre pestañas. El callback adoptaba la sesión notificada y
   trataba un SIGNED_OUT ajeno como propio. Ahora una notificación solo dispara
   lectura de la sesión **de esta pestaña** y validación con Auth, membresía y
   `is_admin()`. La presencia de almacenamiento solo evita un parpadeo de UI:
   nunca concede permisos ni sustituye esas validaciones.
3. Un fallo transitorio de inspección se trataba como denegación permanente y
   descartaba la sesión mostrada. Ahora bloquea el panel y permite revalidar la
   misma sesión. Si Auth confirma que la sesión expiró/fue revocada, se vuelve
   al acceso con una explicación; no se restaura un token anterior.
4. Se seleccionaba siempre el primer autenticador verificado. Ahora se pueden
   distinguir y elegir los existentes. Consultar métodos no elimina factores
   incompletos ni registra otros automáticamente. El primer registro es una
   acción explícita y vuelve a comprobar que no exista un factor verificado.

**Límite del diagnóstico:** no se hizo ningún intento con el usuario/código real.
No se conoce la respuesta concreta que rechazó esa verificación. Un error
`mfa_verification_failed` no ejecuta signOut en el SDK. No afirmamos que el código
real fuera incorrecto. La interfaz ahora diferencia ese rechazo de expiración del
challenge, cambio de conexión, factor eliminado, límite de intentos, red,
rechazo HTTP desconocido y sesión expirada/revocada. No muestra cuerpos, tokens,
IP ni errores sin sanitizar.

GoTrue puede invalidar otras sesiones AAL1 cuando se completa un segundo paso en
otra sesión. Esa revocación legítima debe respetarse; conservar un formulario no
significa que una sesión revocada pueda seguir utilizándose.

## Por qué no aparecía huella, rostro o PIN

Comprobaciones de solo lectura del 21/10/2026:

- Desarrollo en este workspace: ambos interruptores de dispositivos están false y
  no hay RP configurado. No demuestra el contenido del `.env.local` del usuario.
- Proyecto alojado: GET health HTTP 200, Auth v2.197.0; GET settings HTTP 200,
  `passkeys_enabled=false`, correo habilitado.
- Esos endpoints **no** informan la habilitación de MFA WebAuthn ni prueban SMTP.
- Incluso con frontend habilitado, antes no se mostraba el botón si la cuenta no
  tenía un factor WebAuthn verificado, sin explicar esa ausencia.

Ahora se informa si el método está desactivado, si falta configuración del sitio,
si el navegador no lo admite o si todavía no se registró un dispositivo. Cuando
no es compatible, el control queda deshabilitado y el código sigue disponible.
«Actualizar métodos disponibles» solo vuelve a consultar, sin modificar factores.

## Seguridad y compatibilidad

No cambia SQL, RLS, `is_admin()`, permisos, inventario, reservas ni pedidos.
El panel solo se abre tras validar cuenta activa y AAL2 con el servidor.

La passkey primaria **no** satisface sola AAL2 en GoTrue 2.197.0 comprobado localmente.
La alternativa probada con servidor real local es **contraseña + factor del
sistema operativo**. La compatibilidad alojada necesita confirmar la configuración
privada de ese factor y probar el hardware. No se retira el segundo paso actual.
No se crea autenticación propia, biometría de la web ni un JWT que invente AAL2.

## Pasos manuales para terminar la comprobación local

1. Actualizar esta rama, ejecutar `npm ci` y reiniciar `npm run dev`.
2. Entrar nuevamente con correo y contraseña en el mismo origen/navegador. Elegir
   la aplicación correcta si se ofrece más de una. Usar su código vigente; ante
   rechazo, activar hora automática del teléfono y esperar un código nuevo.
3. La renovación del token o un aviso de otra pestaña ya no debe hacer desaparecer
   el formulario. Un fallo de red permite reintentar. Una sesión realmente
   revocada exige ingresar otra vez, sin cambiar innecesariamente la contraseña.
4. Si persiste el fallo, anotar solo el mensaje sanitizado que ahora distingue la
   causa. No compartir el código, tokens, QR, correo ni cuerpos de solicitudes.
   No borrar ni volver a registrar el autenticador para intentar arreglarlo.

## Activación manual para computadora y celular

Estos pasos se preparan para aprobación; no se ejecutaron cambios remotos.

1. Conservar y comprobar el autenticador actual y un acceso de recuperación del
   propietario. Consultar la configuración privada con el GET y campos permitidos
   de [admin-access-final-review.md](admin-access-final-review.md). Confirmar
   habilitación soportada de registro y verificación MFA WebAuthn, además de la
   API de passkeys necesaria para inspeccionar credenciales existentes. No asumir
   que el interruptor de passkeys primarias activa ese segundo factor.
2. Elegir el dominio HTTPS/RP definitivo y orígenes exactos. No registrar
   credenciales de producción en un dominio de preview ni cambiar RP después.
   Solo tras autorización, configurar el servicio y la construcción de VANTA:
   `VITE_ADMIN_DEVICE_MFA_ENABLED=true`, `VITE_ADMIN_RP_ID=RP_APROBADO`.
   Para la modalidad recomendada contraseña + dispositivo, el botón de passkey
   **primaria** puede seguir apagado (`VITE_ADMIN_PASSKEYS_ENABLED=false`). Esas
   variables son públicas; no poner tokens Management/service_role en `VITE_*`.
3. **Computadora:** configurar Windows Hello/PIN, Touch ID o protección equivalente
   del sistema. Usar navegador compatible y el origen HTTPS aprobado. Entrar con
   contraseña + código actual; desde **Seguridad del acceso → Administrar
   dispositivos → Registrar verificación con dispositivo**, completar el diálogo
   nativo. VANTA no solicita cámara ni recibe biometría/PIN. Probar otra sesión
   con contraseña y luego «Ingresar con huella, rostro o PIN».
4. **Celular:** configurar Face ID/Touch ID/bloqueo seguro de Android. Abrir el mismo
   dominio aprobado en Safari/Chrome compatible, completar inicialmente el método
   actual y registrar allí la segunda verificación. El diálogo usa ese teléfono;
   no depende de escanear un QR en su propia pantalla. En accesos posteriores,
   contraseña + dispositivo reemplaza el código cotidiano solo si el servicio
   efectivamente emite AAL2 y `is_admin()` autoriza.
5. `localhost` de la computadora no es el del teléfono. Acceder desde celular a
   una IP privada por HTTP no equivale a un origen HTTPS apto para WebAuthn.
   Para probar en el teléfono hace falta un origen HTTPS confiable, aprobado y
   compatible con el RP; no se proporciona ni inventa un dominio nuevo aquí.
6. Registrar/comprobar otro medio de respaldo antes de cambiar o perder el celular.
   Revocar la credencial antigua desde una sesión autorizada. Si se perdió también
   el segundo paso, la recuperación de contraseña por email **no** lo elimina:
   seguir la recuperación confiable del propietario descrita en
   [admin-access.md](admin-access.md), nunca un bypass de la web.

Si el servicio no habilita el segundo factor experimental, conservar TOTP y no
activar una opción aparente. Una aplicación compatible distinta de Google también
puede proporcionar el código; eso no convierte una passkey primaria en AAL2.

La recuperación PKCE y sus enlaces inválidos/vencidos siguen probándose junto
con la autorización administrativa y la regresión del panel/checkout.

## Validación ejecutada en esta corrección

- Regresión contra `e307bb0`: falla esperada y reproducida en la renovación AAL1,
  al desaparecer el campo del código. Checkout temporal eliminado tras comprobarlo.
- `npm run check`: **373 pruebas / 34 archivos**, lint, TypeScript frontend/Edge
  y build aprobados.
- Navegador: **190/190**, acceso, panel y checkout en 1440/820/375/393/320 px.
  Se usó SDK real del navegador, Supabase simulado y autenticador virtual.
- La prueba de renovación también envía avisos SIGNED_OUT y SIGNED_IN de otra
  pestaña y comprueba que no se adopta su sesión ni se pierde la entrada propia.
- Casos adicionales: código rechazado con reintento, inspección fallida recuperable,
  varios autenticadores, ausencia de métodos sin mutaciones automáticas, sesión
  realmente revocada y dispositivo sin soporte. Usuarios no administradores y
  recuperación de contraseña permanecen en la suite.
- `test:admin:auth` y `test:admin:passkeys`: aprobados con Auth/PostgREST/PostgreSQL
  reales **locales**, JWT firmados, RLS/RPC, AAL1 rechazado, AAL2 autorizado y
  revocación. No prueban el código del usuario ni hardware físico alojado.
- `npm audit`: **0 vulnerabilidades**.

CI vuelve a ejecutarse al subir este commit. No se ejecutaron SQL, login del
propietario, cambios de usuarios/factores, SMTP ni configuraciones remotas.
