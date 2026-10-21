# Revisión final del acceso del propietario — PR #8

## Decisión

Conservar `is_admin()` = perfil activo + JWT `aal2`, RLS y RPC actuales. No hay
cambios SQL, despliegues ni modificaciones del proyecto remoto en esta revisión.
No está aprobado sustituir el segundo paso por una passkey primaria.

| Alternativa | Evidencia | Decisión |
| --- | --- | --- |
| Contraseña + código actual | GoTrue real local, JWT firmados y RLS/RPC; interfaz con respuestas simuladas | Respaldo conservado |
| Passkey primaria sola | GoTrue 2.197.0 real local emite AAL1; `is_admin()` rechaza | Nunca entra directamente al panel |
| Contraseña + factor de dispositivo | GoTrue 2.197.0 real local emite AAL2; RPC autoriza solo administrador activo | Implementado detrás de activación manual; no acreditado en el proyecto alojado |
| Passkey primaria + factor de dispositivo en el mismo autenticador | La integración detectó reemplazo de credencial residente por compartir RP/identidad | Registro de ambas modalidades bloqueado conservadoramente en la cuenta |

El botón de dispositivo es la opción principal cuando hay un factor verificado;
el código de la aplicación queda como alternativa secundaria. En el primer paso,
si se habilitan passkeys primarias, su botón también es principal, con aviso del
segundo paso necesario. No se agrega una opción ficticia cuando los mecanismos
están deshabilitados. El registro y la revocación siguen requiriendo una sesión
administrativa autorizada y comprobación de `is_admin()` en el servidor.

## Qué sabemos del servicio alojado

Lecturas repetidas el 21/10/2026, solo GET autenticado con la clave pública:

- `/auth/v1/health`: HTTP 200, versión `v2.197.0`.
- `/auth/v1/settings`: HTTP 200, `passkeys_enabled=false`, correo habilitado.

Estos endpoints **no informan** si MFA WebAuthn está habilitado ni si se puede
activar para este proyecto/plan. Compartir versión con GoTrue local no certifica
su configuración, restricciones de plataforma o experiencia biométrica física.
No se hizo ningún registro de credenciales, login administrativo ni envío de
correo contra el proyecto real. Tampoco se consultó su configuración privada:
no disponemos de una autorización Management API de lectura para esa consulta.

La guía oficial web de MFA sigue presentando aplicación y teléfono; la referencia
CLI sí expone `auth.mfa.web_authn.enroll_enabled` y `verify_enabled`. Que existan
en CLI/SDK/GoTrue no prueba que estén disponibles en el Dashboard alojado.

**Impedimento actual:** faltan la confirmación de configuración/disponibilidad del
segundo factor en el proyecto alojado y la elección del dominio/RP estable. Hasta
resolverlo, mantener ambos interruptores de VANTA desactivados y el segundo paso
actual. No crear un JWT propio, un hook que invente AAL2, un PIN en localStorage
ni una excepción a RLS. SMS es otro mecanismo MFA de Supabase, pero no proporciona
la experiencia biométrica solicitada y no se incorpora como reemplazo.

## Una comprobación manual de configuración, sin modificarla

El propietario puede consultar la configuración con Management API usando una
credencial con alcance Auth Read, **fuera del navegador de VANTA**. No pegar el
token en el chat, en variables `VITE_*`, archivos versionados ni capturas. Si
no tiene ese acceso, consultar al soporte de Supabase sobre la habilitación del
factor experimental en su proyecto. No basta activar Authentication → Passkeys.

Ejemplo PowerShell, con `SUPABASE_ACCESS_TOKEN` ya disponible de forma segura:

```powershell
$config = Invoke-RestMethod -Method Get `
  -Uri 'https://api.supabase.com/v1/projects/evlbfjvvljbkntlozokt/config/auth' `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" }
$config | Select-Object passkey_enabled, mfa_web_authn_enroll_enabled, `
  mfa_web_authn_verify_enabled, webauthn_rp_id, webauthn_rp_origins
Remove-Variable config
```

No imprimir `$config` completo: la respuesta puede contener configuración sensible.
Propiedades ausentes no equivalen a `false` ni a compatibilidad: confirmar con
Supabase. No ejecutar PATCH, SQL ni cambiar secretos para esta comprobación.

Cuando el propietario autorice la activación, seguir [admin-access.md](admin-access.md):
respaldo comprobado, RP HTTPS definitivo, registro desde AAL2, prueba en una ventana
nueva con contraseña + dispositivo, revocación controlada y prueba física en
computadora/teléfono. Si el servicio no habilita ese factor, conservar el código
actual. Puede usarse cualquier aplicación compatible, sin dependencia exclusiva
de Google Authenticator. No prometer acceso biométrico cotidiano aún no probado.

## Interfaz y recuperación

El borde blanco era el `outline` de `:focus-visible` aplicado al título enfocado
por código. Ahora solo esos títulos reciben una excepción visual. Se mantiene
su foco para lectores de pantalla y los anillos de teclado de botones/enlaces.
El botón de dispositivo ocupa el ancho disponible en móvil y el nombre registrado
se anuncia como descripción accesible, separado de su etiqueta sencilla.

La recuperación sigue siendo PKCE por correo, con verificador independiente por
solicitud, callback limpio, rechazo de enlaces inválidos/vencidos y administrador
activo + AAL2 antes de cambiar contraseña. Un email no reemplaza un segundo factor
perdido; ese caso requiere recuperación confiable del propietario desde Dashboard,
revocación de sesiones y el procedimiento documentado, sin bypass en la web.

Fuentes oficiales consultadas:

- [Passkeys de Supabase](https://supabase.com/docs/guides/auth/passkeys).
- [MFA y niveles de sesión](https://supabase.com/docs/guides/auth/auth-mfa).
- [Configuración CLI](https://supabase.com/docs/guides/local-development/cli/config).
- [Clasificación AAL del servidor](https://github.com/supabase/auth/blob/c3348e8f1cb31454e9783e4eb9eab1e71ad9652f/internal/models/amr.go).

Los resultados de esta revisión se agregan a la PR distinguiendo navegador con
respuestas simuladas, servicios locales reales y lecturas remotas de metadatos.

## Resultados ejecutados de esta revisión

- `npm run check`: lint, TypeScript frontend/Edge, 364 pruebas en 34 archivos y
  build aprobados.
- `playwright test e2e/admin-access.spec.ts e2e/admin.spec.ts e2e/checkout.spec.ts`:
  **155/155**, anchos 1440/820/375/393/320. Son respuestas Supabase simuladas y
  autenticador virtual nativo; incluyen la regresión del borde del título,
  prioridad del dispositivo, descripción accesible, Tab/Enter y ausencia de desbordes.
- `npm run test:admin:auth`: GoTrue/PostgREST/PostgreSQL reales locales, JWT
  firmados, permisos, usuarios no autorizados y desactivación efectiva.
- `npm run test:admin:passkeys`: GoTrue 2.197.0 real local; firma criptográfica,
  AAL1 rechazado, AAL2 autorizado, registro protegido y revocación. Autenticador
  virtual de Chromium: no se probó hardware físico.
- `npm audit`: **0 vulnerabilidades**.

No se atribuyen a esta revisión pruebas SMTP, biometría física o acceso
administrativo del proyecto real. No se repitió la carrera nativa de inventario:
no cambia SQL ni lógica de stock; la suite SQL/PGlite se ejecutó dentro de check.
La suite completa de CI del commit anterior eb0371f terminó aprobada; el nuevo
commit vuelve a disparar CI y su estado se publica en la PR.
