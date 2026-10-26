# Demo pública: solicitudes por actor y admisión global

Base: `main` / `50345f4`, con PR #18–#21. No cambia Edge Functions, frontend,
Mercado Pago, correos, Vercel, secretos, pedidos ni inventario.

## Política y cambio mínimo

- `public.demo_rate_limit(text)`: 60 solicitudes por actor en una ventana fija
  de una hora. No toca el bucket global. Peticiones adicionales devuelven false;
  no extienden el comienzo de la ventana. No cambia el hash del actor.
- `public.demo_admit_creation()`: se **conserva sin reemplazar** la función
  conocida de 60 admisiones globales/hora. Los handlers actuales solo la invocan
  después de Siteverify válido y replay sin pedido existente. Es un presupuesto
  de admisiones, no necesariamente 60 pedidos exitosos: un fallo de creación
  posterior también consume admisión. Recuperaciones/replays y challenges fallidos
  no lo consumen.
- Ambos endpoints (`demo-orders` y `mp-checkout`) ya usan la misma RPC y derivan
  el actor con DEMO_ACTOR_SECRET y el último hop X-Forwarded-For. Se comparte el
  límite si esos valores son los mismos; NAT comparte bucket y la ausencia del
  encabezado usa unknown. No se convierte en identidad/autorización del visitante.
- Se preservan 20 pedidos pendientes, 80 unidades reservadas globales, 2 pedidos
  por capacidad, 12 unidades por pedido, 3 por variante, locks y TTL de 60 minutos.
  La capacidad no identifica una persona. La disponibilidad no queda garantizada
  ante abuso: un usuario puede reservar una variante y una compra sandbox aprobada
  consume stock; este cambio no agrega reposición automática.

Migración nueva: `supabase/migrations/202610260001_public_demo_rate_limits.sql`.
Sustituye exclusivamente el cuerpo de demo_rate_limit conservando firma,
propietario, ACL, SECURITY DEFINER y search_path vacío. No hay grants nuevos ni
modificación/reset de buckets. Un comentario de versión guarda la huella del
predecesor admitido para poder revertirlo; no se crea una tabla de control.

## Compatibilidad obligatoria antes de activar

No se obtuvo el cuerpo real de la RPC alojada: el propietario informó que tiene
actor/global con umbral 6. Eso **no basta** para afirmar una coincidencia exacta.
Se admiten exclusivamente estos cuerpos conocidos, normalizando solo CRLF/LF:

| Función previa | MD5 de prosrc normalizado |
|---|---|
| rate del repositorio: actor, umbral 6 | `8197059cc94f2895bb46c43dd2e867d2` |
| candidato legado exacto: actor y global, umbral 6 | `ac615035e8be0aab815f8b7a2b5edabb` |
| admisión global conocida, umbral 60 | `700b596387cf8e75683f5959428a7dba` |
| creación conocida con capacidad/stock | `88e1442815247686217be3a9616ec965` |

El candidato legado revisable está en
`supabase/tests/fixtures/demo-rate-limit-legacy.sql`. Es una referencia de prueba,
**no una migración para ejecutar** ni una afirmación sobre el contenido remoto.
Si la definición alojada tiene diferencias adicionales, aunque parezcan solo
formato, se detiene la activación hasta revisar el cuerpo real y preparar una
compatibilidad explícita con pruebas. No agregar hashes arbitrarios ni quitar
las guardas. No reemplazar la RPC alojada por la del fixture para forzar el check.

También se verifican firmas booleanas, lenguaje, SECURITY DEFINER, search_path
vacío, propietario coherente con creación, permisos privados, ausencia de grants
adicionales/ejecución pública y ausencia de comentario previo inesperado.
Si hay una personalización legítima de permisos o comentarios, se revisa primero;
no se borra para pasar la guarda.

## Aplicación manual ordenada — no ejecutada

1. Confirmar proyecto VANTA y revisión aprobada; mantener configuración y servicios
   actuales. Guardar de forma privada las definiciones/ACL previas para revisión.
2. Ejecutar **solo lectura** `supabase/operations/public-demo-rate-preflight.sql`
   completo como propietario. Incluye verificación que falla con excepción y
   muestra las dos definiciones, propietarios, ACL y ventanas globales. Cualquier
   error significa **STOP**, sin aplicar la migración. Si el cliente deja de
   mostrar resultados tras un error, no ejecutar solo el SELECT para saltar el DO.
3. Revisar las huellas de la tabla anterior. La migración repite todas las guardas
   dentro de su transacción: un preflight viejo no permite aplicar con drift nuevo.
4. Tras aprobación explícita, ejecutar completa la **nueva**
   `202610260001_public_demo_rate_limits.sql`, incluidos BEGIN y COMMIT. No ejecutar
   ni reaplicar migraciones anteriores. No ejecutar el fixture legado.
5. Ejecutar `supabase/operations/public-demo-rate-verify.sql` (solo lectura).
   La huella nueva debe ser `61d9dc8a90848f308f95d5c87244d2cf`; admisión y creación
   mantienen sus huellas. La verificación comprueba también el marcador de
   reversión y las garantías de seguridad.
6. No desplegar funciones: ambas funciones Edge actuales ya consumen esta firma.
   No cambiar secretos, activar flags ni publicar Vercel por este incremento.
   Si se pretende habilitar una opción que hoy está apagada, es otra operación
   que requiere autorización.

### Ventanas y contadores existentes

No se borran ni reducen contadores. Si la RPC antigua incrementaba global antes
  del CAPTCHA y usa el mismo bucket que demo_admit_creation, esos intentos siguen
contando hasta terminar la ventana. Puede mantenerse un 429 temporal incluso tras
corregir la definición. Del mismo modo, un actor que ya tenga más de 60 intentos
queda bloqueado hasta el vencimiento natural. No resetear ni cambiar de nombre
los buckets para evitarlo. Esperar las ventanas existentes antes de abrir la demo
al público; los timestamps de la verificación permiten conocer su fin.

Consultas adicionales de solo lectura (no exponen IP ni nombres de buckets actor):

```sql
select count(*) as buckets_actor_activos,
       max(attempts) as max_intentos,
       max(window_start+interval '1 hour') as fin_ultima_ventana
from public.demo_request_limits
where bucket like 'actor:%' and window_start>clock_timestamp()-interval '1 hour';

select count(*) as pendientes,
       min(reservation_expires_at) as proximo_vencimiento
from public.orders where is_demo and status='pending';

select coalesce(sum(r.quantity),0) as unidades_reservadas
from public.stock_reservations r join public.orders o on o.id=r.order_id
where o.is_demo and r.status='active';
```

No llamar manualmente a los limitadores como "consulta": incrementan contadores.
Las pruebas de fronteras/concurrencia se realizan solo en bases desechables.

## Reversión manual

`supabase/operations/public-demo-rate-rollback.sql` exige el cuerpo nuevo exacto,
metadatos seguros, admisión/capacidad intactas y marcador previo reconocido.
Restaura el predecesor indicado por ese marcador: actor 6 o actor/global 6, con
normalización de saltos de línea. Conserva dueño, ACL, todos los contadores y sus
ventanas, y restaura comentario nulo. No toca pedidos, pagos o reservas.

La reversión al legado **reintroduce el límite global de 6** y vuelve a incrementar
su bucket con solicitudes anteriores a Turnstile. Debe aprobarse sabiendo ese
impacto; preferir corregir hacia adelante si aparece un problema de compatibilidad.
Los contadores acumulados pueden causar 429 hasta su renovación: no borrarlos.
No requiere revertir Edge Functions, pagos, correos ni migraciones anteriores.

## Pruebas y alcance

La suite nueva prueba ambos predecesores exactos y el rechazo de drift en cuerpo,
seguridad, permisos, search_path, admisión y comentarios. Verifica restauración de
cada variante, conservación de contadores, independencia de actores/global y el
presupuesto compartido de recuperación entre los dos handlers reales con RPC SQL
PGlite. Las suites históricas mantienen la cobertura de sus migraciones originales;
no se reescriben esas migraciones para aparentar el estado nuevo.

`npm run test:rates:postgres` usa exclusivamente un contenedor LOCAL desechable,
no acepta un DSN remoto y ejecuta carreras de solicitudes, renovación, admisión,
idempotencia, capacidad y vencimiento. Se incorpora al job PostgreSQL de CI.
No se usan credenciales reales ni se ejecutan pagos o llamadas a proveedores.
La coincidencia de la definición alojada y la activación real siguen pendientes
hasta que el propietario ejecute/apruebe el preflight y la migración.

Resultados locales ejecutados:

- `npm run check`: **1.062 pruebas / 60 archivos**, lint, TypeScript Edge/frontend
  y build aprobados. La nueva suite aporta 16 casos sobre `main` / `50345f4`.
- Repetición focalizada tras incorporar la verificación posterior y renovación
  global: **31 aprobadas** (política nueva + handler demo-orders).
- `npm run test:rates:postgres`: **7 escenarios PostgreSQL 17 nativo aprobados**,
  incluidas 80 llamadas concurrentes, renovación simultánea, admisión global,
  ambos predecesores, rollback y carreras de pedidos/stock/expiración.
- `git diff --check` aprobado. No hay dependencias nuevas. No se repitieron
  navegador ni servicios externos: no cambia frontend/Edge y el runtime de ambos
  handlers está cubierto en la prueba integrada de recuperación compartida.
