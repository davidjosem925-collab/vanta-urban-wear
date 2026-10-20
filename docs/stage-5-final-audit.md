# Etapa 5 — Auditoría final y despliegue manual

Fecha: 20 de octubre de 2026. Rama `feat/stage-5-orders-stock`, PR #6.

## Dictamen

**La migración corregida está lista para revisión y aprobación manual condicionada
al preflight de propietarios, columnas/restricciones y privilegios efectivos. No
está autorizado ni verificado el encendido de pedidos remotos.** No se ejecutaron
cambios en el Supabase real, despliegues ni activaciones de extensiones. No se
fusionó la PR ni se implementó un panel administrativo.

Las comprobaciones remotas de esta auditoría son las aportadas por el operador:
96 filas de inventario, disponibilidad mínima 6; tablas existentes; pgcrypto
instalado; pg_cron disponible pero no instalado; estados originales
pending/paid/cancelled/expired/fulfilled/refunded; is_admin SECURITY DEFINER con
search_path vacío, auth.uid() y membresía activa; políticas admin_read para
usuarios autenticados; service_role con permisos amplios y authenticated solo
SELECT en las cinco tablas administrativas. **No equivalen a haber inspeccionado
personalmente todas las columnas, roles heredados, triggers o servicios remotos.**

## Hallazgos y correcciones

| Hallazgo | Riesgo antes de corregir | Corrección y prueba |
|---|---|---|
| Plazo comprobado antes de esperar inventario | Una confirmación iniciada dentro del plazo podía consumir después del vencimiento | Comprobar reloj servidor después de todos los locks; prueba multiconexión que demuestra bloqueo antes del deadline y liberación después |
| Padres del catálogo derivados antes de bloquear el hijo | Reasignar variante/producto podía dejar al nuevo padre sin lock y permitir snapshots/importes inconsistentes | Locks variante → producto → categoría → inventario, UUID ordenado en cada nivel; prueba cambia el padre y comprueba que su precio queda bloqueado |
| REVOKE parcial retenía TRIGGER/REFERENCES de ALL | No era correcto afirmar que quedaban únicamente privilegios de lectura; TRIGGER es especialmente peligroso junto con escrituras privilegiadas | REVOKE ALL en las cuatro tablas existentes protegidas, GRANT SELECT explícito; tabla nueva de movimientos ya revoca ALL. Verificación de escrituras/TRIGGER/REFERENCES efectivos en los tres roles API |
| Errores de infraestructura en replay se etiquetaban como conflicto | Diagnóstico incorrecto ante problemas de permisos/conexión | Solo conflictos reales devuelven 409; infraestructura devuelve 503 sin detalles y permite reintentar el mismo intento |
| Coerción de modalidades en Edge y configuración separada de origen/hostname | Entradas de tipos incorrectos o configuración incoherente llegaban demasiado lejos | Tipos string estrictos; origen exacto sin path, HTTPS salvo loopback, y hostname consistente; cierre seguro con pruebas |

La migración aún no aplicada se corrigió en su archivo original
`202610200001_demo_orders.sql`. **No ejecutar una segunda copia ni reaplicar sobre
una versión anterior ya aplicada**. Si alguien la hubiese aplicado pese al estado
previsto, detener el procedimiento y preparar una migración incremental revisada.

## Compatibilidad SQL y alcance

- `orders_status_check` se amplía conservando todos los estados originales. El
  nuevo CHECK limita pedidos is_demo a la máquina de estados demo; no convierte
  ni invalida pedidos comerciales existentes.
- Las nuevas columnas de pedidos/ítems admiten filas históricas sin referencia,
  producto capturado ni vencimiento demo. Las referencias públicas nuevas son UUID
  únicos aleatorios; múltiples NULL históricos no violan unicidad.
- Se reutilizan las cuatro tablas existentes. No se modifica on_hand/reserved,
  precio, variantes, Storage ni productos durante la migración. Índices, FKs y
  funciones se prueban sobre las migraciones completas iniciales.
- `sha256(bytea)` es función incorporada de PostgreSQL, no depende de dónde esté
  instalado pgcrypto. Preflight comprueba su presencia. No se instala extensión.
- RLS existente y is_admin() no se reemplazan. La única política añadida es
  admin_read de la tabla nueva de movimientos. Tablas de límites/tombstones no
  tienen grants de datos para roles API.
- BEGIN/COMMIT evita instalación parcial. Ejecutar el archivo completo como
  propietario confiable, con ventana corta de mantenimiento por ALTER TABLE.
  Si un grant heredado inesperado deja escritura efectiva, el guard final lanza
  excepción y revierte la migración completa. No arreglarlo con GRANT ALL.

## SECURITY DEFINER y revocación de service_role

| Operación | Invocador autorizado | Identidad SQL que escribe | Acceso directo de tablas necesario al invocador |
|---|---|---|---|
| rate/admit/replay/create/cancel | service_role desde Edge | propietario confiable de la función | ninguno para escribir |
| confirmar/cancelar/preparing/delivered/ajuste | authenticated **y** is_admin() activo | propietario confiable de la función | ninguno para escribir; RLS controla SELECT |
| expire/cleanup | propietario DB mediante cron/manual autorizado | propietario confiable de la función | ningún permiso service_role |
| resolve interno / receipt | solo llamadas internas/propietario | contexto del wrapper | no EXECUTE público |

Cada función privilegiada tiene search_path vacío y referencias calificadas;
no interpola entradas del cliente en SQL dinámico. Se revoca EXECUTE de PUBLIC,
anon, authenticated y service_role antes de conceder la lista mínima. Los helpers
y jobs no se exponen a los roles API. **No conceder EXECUTE de todas las funciones
a service_role para “hacer funcionar” cron.**

Las pruebas ejecutan creación/cancelación como service_role, confirmación como
un authenticated admin activo y expiración como propietario después de la
revocación. Funcionan porque SECURITY DEFINER usa al propietario, no al invocador.
Si las funciones se creasen bajo service_role o un propietario sin derechos/
bypass RLS suficiente, sí fallarían. El guard rechaza los tres roles API como
rol de migración; preflight/verify muestran dueños, RLS forzado y flags de rol.
No cambiar el propietario de las funciones a un rol API posteriormente.

El secreto service_role **sigue siendo altamente privilegiado** sobre otros
recursos del esquema original y puede omitir RLS. Esta revocación no lo convierte
en una credencial segura para el navegador ni protege frente a un backend
comprometido. Edge crea su Authorization fijo desde el binding server-side y no
reenvía el Authorization aportado por el visitante. Una clave pública no puede
invocar las RPC privadas. No se identificó una ruta pública de escalada en las
pruebas; la frontera HTTP real requiere el smoke test posterior al despliegue.

Antes de aprobar, inventariar otros jobs/endpoints/automatismos que pudieran
escribir directamente las cuatro tablas con service_role. No existen en el
repositorio de etapas 1–4; no se puede descartar un consumidor remoto externo.
Esos consumidores perderían DML por diseño y deben adaptarse a operaciones
transaccionales autorizadas, no restaurar permisos indiscriminadamente.

## Idempotencia, reservas y concurrencia

Disponibilidad = on_hand − reserved. Crear aumenta reserved, liberar lo reduce,
y confirmar administrativamente resta ambos contadores. Una única transacción
crea el pedido, snapshots, reservas y movimientos, o revierte todo. Clave UUID,
hash JSONB del servidor y capacidad privada aleatoria son independientes de la
referencia pública. Repetir el mismo intento devuelve el resultado; cambiar
contenido/capacidad produce conflicto. Tombstones impiden recrear claves limpiadas.

La admisión serializa creaciones a escala portfolio. Bloqueos de pedido primero
en resolución, luego inventarios por UUID, evitan doble devolución frente a
cancelación/expiración. Un índice único permite un solo movimiento terminal por
pedido/variante. Confirmar consume la reserva; estados posteriores no la retienen.
No hay reintegro automático después de consumir.

El vencimiento es exactamente creación del servidor +60 minutos. Resolver lo
recomprueba **después** de esperar inventario. El cron minutely libera en el primer
tick posterior; no se promete ejecución exacta al segundo. Sin cron sano podrían
quedar unidades retenidas más tiempo: **es condición de habilitación, no un
pendiente opcional**. Alertar si overdue supera 0 tras el margen operativo.

## Turnstile, límites y riesgos operativos

- Endpoint invitado con verify_jwt=false solo en demo-orders; no es un endpoint
  administrativo. CORS no autentica: clientes de servidor pueden falsificar Origin.
- Crear exige Siteverify exitoso con hostname exacto y action demo-order. Widget
  compacto, secreto solo Edge y site key pública en frontend. No usar claves de
  prueba de aceptación automática en el sitio público. Fallos cierran la operación.
- Precios, publicación y límites también se validan en SQL; no hay importe/stock
  local confiable. Rate limit durable por bucket y presupuesto global después de
  CAPTCHA válido; límites globales de reservas/unidades frenan agotamiento.
- X-Forwarded-For solo es útil como bucket si el gateway sobrescribe/agrega de
  forma confiable el último hop. Verificarlo sin registrar IPs ni secretos. Hasta
  verificarlo, no atribuir al límite por IP una garantía fuerte; challenge y límites
  globales siguen aplicando. NAT comparte cuota y puede producir 429 legítimos.
- Six requests/hora por bucket incluye reintentos/cancelación. La demo prioriza
  protección de inventario sobre disponibilidad; no es defensa absoluta contra
  botnets, personas resolviendo CAPTCHA ni denegación de servicio.
- Contacto/domicilio nunca se envían al backend. Retención terminal 30 días más
  intervalo de limpieza; hashes mínimos de idempotencia se conservan para impedir
  duplicados. No hay pagos ni comunicaciones reales.

## Guía manual, con puntos de control

### 1. Congelar y respaldar

Actualizar la rama al commit auditado y comprobar CI verde. Mantener bandera false.
Confirmar proyecto **evlbfjvvljbkntlozokt**, respaldo restaurable y ausencia de otra
versión de esta migración aplicada. Inventariar consumidores service_role.

### 2. Preflight de solo lectura

SQL Editor, rol confiable (habitualmente postgres): ejecutar completo
`supabase/operations/stage-5-preflight.sql`. Comparar columnas, FKs, CHECKs y dueños
con las migraciones originales. Guardar agregados de inventario y recuentos.
Esperado del reporte del operador: 96 filas, mínimo disponible 6, estados originales,
RLS activo, is_admin() seguro, pgcrypto instalado y pg_cron disponible sin instalar.
`builtin_sha256` no debe ser NULL. No debe existir demo_* ni columnas de demo previas.
Si hay diferencias no explicadas, parar; no adaptar SQL a ciegas en el Editor.

### 3. Aprobar/aplicar solo la migración corregida

Ejecutar una vez el archivo completo
`supabase/migrations/202610200001_demo_orders.sql`, BEGIN…COMMIT, como el propietario
confiable. No ejecutar las migraciones iniciales, seeds, db reset ni scripts de
carga. Registrar aplicación en el historial usado por el equipo. Un error deja
la transacción abortada: ROLLBACK y revisar la causa, no continuar desde la mitad.

### 4. Verificación posterior de esquema/permisos

Ejecutar `supabase/operations/stage-5-verify.sql`. Comparar inventario agregado y
catálogo contra el preflight antes de permitir pedidos. Esperado: 96 inventarios,
existencias/reservas iguales a las previas, 12 productos y 96 variantes si ese es
el baseline confirmado. Todas las escrituras/TRIGGER/REFERENCES API deben ser
false; anon no ejecuta ninguna demo_*. Authenticated ejecuta solo los dos wrappers
administrativos y service_role solo rate/admit/replay/create/cancel. Helpers/jobs
sin EXECUTE API. RLS sigue activo y owner de funciones es confiable.

Los recuentos de invariantes deben ser 0. Si el contador reserved ya no coincide
con reservas activas del esquema previo, investigar y conciliar mediante un
procedimiento aprobado antes de habilitar la demo; no recalcularlo automáticamente.
Las comprobaciones no muestran datos de compradores.

### 5. Habilitar pg_cron tras aprobación separada

Dashboard → Database → Extensions → buscar pg_cron y habilitarlo. No lo activa la
migración. Repetir consulta de pg_extension del preflight. Revisar
`supabase/operations/stage-5-schedule.sql` y ejecutarlo como propietario autorizado:
crea/actualiza los dos jobs nombrados. El script se detiene si pg_cron no existe o
el rol no puede ejecutar los jobs. No usar service_role ni secretos HTTP para cron.

Ejecutar por separado las dos consultas cron comentadas al final de verify.sql.
Esperado: jobs activos, horario `* * * * *` y `17 * * * *`, database correcta,
username propietario confiable y ejecuciones recientes success. Verificar runs
de cada job; no basta con que aparezca programado. Retención es horaria.

### 6. Configurar Turnstile y Edge

Crear widget aprobado con hostname final, obtener site key pública y secreto real.
En Edge Secrets configurar `TURNSTILE_SECRET_KEY`, `DEMO_ALLOWED_ORIGIN` exacto
(HTTPS, sin path/barra final), `DEMO_CHALLENGE_HOSTNAME` igual al hostname del origen
y `DEMO_ACTOR_SECRET` aleatorio de al menos 32 caracteres. Localhost admite HTTP
solo para pruebas. Confirmar bindings automáticos SUPABASE_URL y
SUPABASE_SERVICE_ROLE_KEY de Edge; no copiarlos a VITE, chat, logs ni commits.

Después de autorización, con CLI autenticada al proyecto correcto:

```bash
supabase functions deploy demo-orders --project-ref evlbfjvvljbkntlozokt --no-verify-jwt
```

La función construye sus RPC con el binding fijo; no habilitar un proxy genérico.
Aplicar CSP del hosting para Cloudflare si existe; comprobar el widget desde el
origen final y un móvil de 320px. Mantener frontend público con bandera false.

### 7. Smoke tests autorizados en staging

Antes de permitir visitantes, ejecutar el flujo con challenge genuino y datos
ficticios en un entorno de pruebas equivalente. Para probar contra el proyecto
real, solicitar autorización específica: estos smoke tests **crean reservas**.
No pegar service keys en consolas del frontend. Guardar claves/capacidades de
prueba solo en un entorno privado y no registrar cuerpos HTTP.

- Clave pública directa a RPC create/cancel/resolve/expire: rechazada por permisos.
- Clave pública GET orders/items/inventory: sin filas privadas; anon normalmente
  recibe error de permisos. Usuario autenticado común no ve pedidos ajenos.
- Origin incorrecto, challenge falso/reutilizado o hostname/action incorrectos:
  sin pedido/reserva. Infraestructura ausente: error, no éxito.
- Creación válida vía Edge: un pedido pending, precio/suma actuales, deadline +60m,
  reserved aumenta una vez y on_hand no cambia. Repetir exactamente clave/capacidad/
  payload devuelve el mismo recibo; otro cuerpo/capacidad se rechaza.
- Cancelar con referencia sin capacidad correcta no funciona. Cancelar propio una
  y dos veces produce una sola liberación. Verificar invariantes de verify.sql.
- Una reserva válida dejada 60 minutos pasa a expired por cron **sin navegador
  abierto**, normalmente antes del minuto 62; reserved vuelve al baseline. No
  editar fechas ni stock remoto para acelerar esta comprobación.
- Admin autenticado existente y activo puede usar el wrapper autorizado; usuario
  común no. Confirmación consume una vez, después no hay liberación de expiración.
  Esto consume stock de demo: ejecutar solo en staging o con aprobación explícita.
- 429, timeout y error de stock/precio conservan carrito; solo recibo válido limpia
  cantidades confirmadas. Contacto/domicilio no aparecen en requests/DB/logs.

### 8. Encendido final

Solo con todas las puertas anteriores aprobadas:

```dotenv
VITE_DEMO_ORDERS_ENABLED=true
VITE_TURNSTILE_SITE_KEY=site_key_publica_aprobada
```

Reconstruir/desplegar frontend y revisar un pedido autorizado. Nunca introducir
service_role en variables públicas. Mantener monitoreo de overdue, invariantes y
runs de cron. La bandera false conserva el checkout de etapa 4 sin referencias
persistidas ni reservas; no simula éxito de servidor.

### 9. Recuperación

Si falla Edge/Turnstile, apagar bandera y reconstruir; conservar clave de intento
pendiente para consultar su resultado. Si falla cron, deshabilitar nuevas creaciones,
corregir scheduler y ejecutar como propietario `select public.demo_expire_orders();`
por lotes aprobados hasta overdue=0. No borrar pedidos pending ni restar contadores
a mano. No desactivar expiración mientras queden reservas activas.

Si migración falla antes de COMMIT, ROLLBACK. Después de COMMIT no eliminar tablas/
funciones ni restaurar GRANT ALL como arreglo rápido: preparar corrección versionada
con revisión. Este trabajo no ejecuta ninguna de estas operaciones remotas.

## Pruebas y límites del dictamen

CI incluye esquema completo PGlite, permisos efectivos, todos los EXECUTE anónimos,
RPC con sus roles, regresión Edge y PostgreSQL real con conexiones independientes.
Las carreras nuevas usan barreras de locks observadas en pg_stat_activity, no un
sleep supuesto para decidir quién ganó. Se conservan las pruebas de inventario,
idempotencia, RLS, cancelación/expiración y las 75 de navegador de ambas modalidades.
Los resultados finales quedan en PR #6 y CI del commit auditado.

No se verificaron en remoto Auth/PostgREST, headers del gateway, secretos/widget,
función desplegada ni jobs reales: son puertas de puesta en marcha. La revisión
estática y PostgreSQL local no sustituyen esos smoke tests. El bundle conserva
la advertencia no bloqueante de tamaño ya documentada. No se detectó necesidad
de ampliar acceso público, cambiar RLS existente o habilitar pagos/etapa 6.
