# VANTA — Etapa 6: administración y activación manual

Esta PR implementa el panel en `/#/admin`. Tienda y checkout siguen siendo una
**demostración sin cobros**. No despliega, publica, ejecuta SQL remoto ni modifica
usuarios, secretos, productos, imágenes o reservas del proyecto real.

## Arquitectura y alcance

- Cliente Auth propio (`vanta.admin.auth.v1`), importado solo con el panel. Sesión
  por pestaña en sessionStorage; solo el verificador PKCE temporal de recuperación
  usa localStorage para abrir el correo en otra pestaña del mismo navegador.
  El cliente público permanece anónimo; nunca utiliza esa sesión ni caché privada.
- Login, logout, contraseña, recuperación PKCE y TOTP. Se comprueba el usuario con
  Auth y su membresía activa en servidor; el nivel AAL2 se exige en `is_admin()`.
  Ocultar rutas no autoriza: RLS y cada RPC vuelven a comprobar la identidad.
- `admin_membership()` solo devuelve si el usuario actual es miembro activo, sin
  dar permisos ni exponer perfiles. Permite entrar al paso MFA con AAL1.
- Sin alta pública ni asignación de roles desde metadata. `admin_profiles` solo se
  provisiona por un operador confiable. El panel no gestiona administradores.
- Formularios de catálogo/precios ARS en centavos, borradores/publicación y
  variantes. No hay borrado físico de productos/variantes históricos: se desactivan.
  Edición optimista evita pisar cambios. Crear variante crea inventario cero en la
  misma transacción. Los ajustes físicos reutilizan la RPC auditada de etapa 5,
  con motivo y clave idempotente; no pueden invadir `reserved`.
- Ajustes sin respuesta conservan su identidad en sessionStorage por usuario;
  consultar/reintentar busca el movimiento y reutiliza la misma clave. Un fallo
  definitivo de stock permite corregir datos. No repetir un ajuste como una nueva
  operación si todavía hay otro pendiente. Los motivos no deben contener PII.
- Fotografías: JPEG/PNG/WebP/AVIF hasta 5 MiB, decodificación real y límite 40 MP.
  Se conserva el original y se generan tres WebP compatibles con los perfiles de
  catálogo/carrito. INSERT sin upsert en `vanta-admin/<uuid>/...`; bucket privado,
  vista previa firmada 15 min, texto alternativo, orden y desvinculación atómicos.
  No hay UPDATE/DELETE de objetos por el panel. Cargas fallidas pueden dejar
  archivos privados huérfanos sin publicar: limpieza solo por operador, previa
  comprobación de referencias y aprobación; no hay borrado automático.
- Las galerías se guardan con snapshot esperado y validación de archivos en
  Storage; cambios concurrentes se rechazan y se recargan antes de reintentar.
  Los originales siguen existiendo al retirar una foto. Una URL firmada ya emitida
  puede seguir funcionando hasta expirar; no se promete revocación instantánea.
- Pedidos: listado/paginación/filtros y detalle **solo de is_demo=true**. Se piden
  columnas mínimas, sin capacidades, claves de idempotencia, contacto o domicilio.
  Los snapshots se preservan. No se añaden botones de pago ni cambios de estado.
- La migración endurece las políticas administrativas existentes con MFA y revoca
  DML directo del catálogo. No cambia SQL de creación, locks, reserva, idempotencia,
  vencimiento o cron de etapa 5. Stock/pedidos siguen sin DML directo de roles API.

## Activación: pasos que debe realizar el operador después de aprobar la PR

### 1. Preflight y respaldo

Confirmar proyecto `evlbfjvvljbkntlozokt`, respaldo y commit aprobado. La etapa 5
ya debe estar aplicada y funcionando; **no volver a aplicar sus migraciones**.
Con SQL Editor como propietario confiable, ejecutar de solo lectura
`supabase/operations/stage-6-preflight.sql`. Guardar agregados antes/después.
`auth.jwt()` y la RPC de inventario deben existir; las RPC admin nuevas no.
Inspeccionar propietarios y las políticas Storage esperadas. Si hay drift o esta
migración ya existe, detenerse y revisarlo; no forzar su reaplicación.

### 2. Usuario administrativo y Auth

En Dashboard > Authentication, crear el usuario por un canal confiable.
Para establecer su primera contraseña puede usar la recuperación del panel; no
depender de un enlace de invitación implícito, que este panel no procesa.
Usar contraseña fuerte (mínimo recomendado 12 caracteres), desactivar registro
público y habilitar inscripción/verificación TOTP. Configurar el servicio de correo
para invitaciones y recuperación, con sus límites de Auth habilitados.

El operador debe comprobar el UUID real en Auth y provisionar solo esa membresía.
Ejemplo **manual**, reemplazando el marcador; no copiar un UUID de datos demo:

```sql
-- Revisar primero que el UUID corresponde al usuario Auth correcto.
insert into public.admin_profiles(user_id, display_name, active)
values ('<UUID_REAL_DE_AUTH>', 'Administración VANTA', true)
on conflict (user_id) do update
set display_name=excluded.display_name, active=excluded.active;
```

La FK evita usuarios inexistentes, pero no identifica por vos a la persona correcta.
No conceder DML de esta tabla a authenticated ni usar user*metadata para autorizar.
No guardar contraseña, secreto TOTP, service_role o sb_secret*_ en VITE\__ ni Git.

### 3. Migración incremental, una vez

Aprobar y ejecutar completo como propietario confiable el archivo nuevo
`supabase/migrations/202610200002_admin_panel.sql`. Está encerrado en una transacción.
Crea tres RPC de catálogo y membership; endurece `is_admin()` con AAL2, restringe
escrituras del catálogo a RPC y hace inmutables objetos originales para el panel.
No resetea inventario, no cambia precios/pedidos, ni desplaza deadlines.

Durante la activación, los administradores anteriores necesitarán MFA. La tienda
anónima, el endpoint demo-orders y los jobs propietarios siguen funcionando. No
restaurar GRANT ALL ni desactivar RLS para solventar errores.

### 4. Dominio, recuperación y primer acceso

En Authentication > URL Configuration establecer Site URL del sitio aprobado y
permitir exactamente los callbacks de ese origen y los locales que realmente se
usen. La recuperación usa:

`https://DOMINIO_APROBADO/?admin_recovery=1#/admin`

En desarrollo: `http://localhost:5173/?admin_recovery=1#/admin` (o el hostname/puerto
real, sin alternarlos durante PKCE).

El SDK añade `sb_flow_id` al callback. Además del callback base, permitir su patrón
acotado, con host y ruta fijos, para cada origen aprobado:

```text
https://DOMINIO_APROBADO/?admin_recovery=1&sb_flow_id=*#/admin
http://localhost:5173/?admin_recovery=1&sb_flow_id=*#/admin
```

El único comodín corresponde al identificador temporal del SDK; no abrir hosts,
puertos ni rutas arbitrarias. Confirmar en el correo de prueba que se conserva
`admin_recovery=1`, `sb_flow_id` y `#/admin` (sin copiar códigos a logs o capturas).
Abrir el enlace del correo en el mismo navegador donde se solicitó. El código se
consume una vez, se retira de la URL y se exige acceso/MFA antes de cambiar clave.
Un enlace caducado o de otro navegador requiere solicitar otro, no saltarse MFA.

Abrir `/#/admin`, ingresar y pulsar Continuar con MFA. Si es la primera vez,
escanear el QR con una aplicación autenticadora y verificar los seis dígitos.
El QR/semilla es una credencial: no adjuntarlo a capturas, PR ni logs. Si ya existe
factor verificado, solo se solicita su código. Se pueden renovar factores sin
verificar del mismo usuario; nunca se elimina un factor verificado desde el panel.

Para pérdida de MFA: gestión confiable en Dashboard, no un bypass en frontend.
Desactivar membresía bloquea inmediatamente nuevas operaciones incluso con JWT
anterior. Revocar sesiones de Auth y seguir el procedimiento de recuperación del
proveedor. No reactivar una identidad comprometida mientras sus JWT AAL2 anteriores
sigan vigentes; puede provisionarse otra identidad confiable sin borrar el historial.

### 5. Verificación de solo lectura y publicación aprobada

Ejecutar `supabase/operations/stage-6-verify.sql` como propietario. Esperar ceros en
invariantes, DML false y sin EXECUTE para anon/service_role sobre RPC nuevas.
SQL Editor sin JWT de usuario dará is_admin=false: no modificar el guard por eso.
Comparar agregados con preflight. Mantener `vanta-demo-expiry` y sus permisos actuales.

No hay secretos nuevos ni una Edge administrativa que desplegar. Solo se usa la
clave publicable ya existente y el JWT normal del usuario. Preparar el build con
las mismas variables públicas; preservar VITE_DEMO_ORDERS_ENABLED y la site key
aprobada. Si cambia el dominio al publicar, revisar manualmente origen/hostname
permitidos por la Edge y Cloudflare, sin desactivar Turnstile o ampliar orígenes.

`vercel.json` prepara build/output y cabeceras (CSP, no-referrer, nosniff, antiframing,
HTTPS). El CSP incluye el dominio público actual de Supabase y Turnstile. Si se
elige otro hosting/proyecto, revisar explícitamente esos orígenes, no usar \*.
No contiene credenciales ni dispara un deploy desde esta PR. Al conectar Git a un
hosting, configurar primero el control de despliegues para que un push no publique
sin la aprobación requerida. Comprobar HTTPS, callback, login/MFA, recuperación y
URLs privadas en el dominio final antes de publicar.

### Reversión segura

Se puede retirar el acceso al panel/frontend sin tocar los datos ni desmontar
etapa 5. Desactivar la membresía bloquea nuevas operaciones. Mantener las
restricciones nuevas y los objetos originales; no ejecutar rollback destructivo,
volver a conceder DML o devolver is_admin a AAL1 como solución rápida. Si se
requiere revertir SQL, preparar una migración correctiva revisada y respaldada.

## Pruebas y límites

- `npm run check`: frontend/backend/PGlite SQL, roles, MFA, grants, Storage policies,
  edición concurrente, variantes/inventario atómicos, galería y regresiones 1–5.
- `npm run test:orders:postgres`: conexiones PostgreSQL 17 independientes; también
  aplica la migración nueva solo en base descartable y prueba ajuste vs expiración,
  reintento y edición optimista con AAL2. Nunca acepta DSN remoto.
- `npm run test:admin:auth`: contenedores descartables de GoTrue v2.177.0 y
  PostgREST v12.2.12, PostgreSQL 17 y puertos solo 127.0.0.1. Prueba contraseña,
  enrolamiento TOTP, códigos reales, JWT AAL1/AAL2, firma manipulada, metadata sin
  privilegios, RLS/RPC y revocación. Crea/borra solo esos contenedores con datos
  ficticios. Docker debe estar disponible; las imágenes públicas se descargan si
  faltan. Estos scripts de contenedores usan el socket Unix de Docker: ejecutar
  en Linux o WSL con Docker disponible; CI los ejecuta en Ubuntu. No toman
  credenciales/URLs del proyecto real. CI incluye este comando.
- `npm run test:e2e`: tienda/carrito/checkout y panel a 320/375/393/820/1440 px.
  Fixture de Auth/API para UX, no prueba de correo ni del Storage HTTP alojado.
- `npm run test:e2e:orders`, pruebas Deno y controles demo/images offline conservados.
- `npm audit`, TypeScript y build. El panel se carga diferido y no amplía el contrato
  de lectura del catálogo público.

Resultados realmente ejecutados y enlaces a CI en la descripción de la PR. No se
certifica que Auth/SMTP, RLS, Storage, DNS, cabeceras o callbacks del proyecto remoto
estén activados por haber probado localmente. El servicio Storage HTTP alojado y
la entrega real de correo requieren el smoke test manual anterior; las políticas
se prueban con PostgreSQL y uploads con fixtures del navegador. No se enviaron
correos ni se ejecutó ninguna operación administrativa contra Supabase remoto.
