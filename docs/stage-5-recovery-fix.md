# Etapa 5 — Recuperación de intentos y Turnstile

## Alcance y diagnóstico

Corrección en PR #6, `feat/stage-5-orders-stock`. Según el operador, la migración
ya está aplicada, pg_cron funciona y `demo-orders` está desplegada. Este ajuste
no cambia SQL, privilegios, RLS, stock, secretos ni datos remotos y no requiere
reaplicar migraciones. No se desplegó ninguna función desde esta revisión.

El defecto comprobado era `recover: () => confirm(null, "")`: si el replay no
hallaba un pedido, la consulta seguía por la ruta de creación y enviaba un token
vacío a Siteverify. El 403 resultante no significaba que hubiese un pedido ni
explicaba el resultado del primer intento. Consultar repetidamente no podía
resolver ese estado.

También se podía pulsar confirmar antes de recibir el token del widget. Los
rechazos HTTP se presentaban como errores de conexión; los fallos de Turnstile
no distinguían token consumido, configuración y contexto. Los callbacks de un
widget eliminado podían cambiar el token de su sucesor. Ahora se exige token,
se consume localmente antes de enviar, se renueva el widget después de cada
confirmación y se ignoran callbacks de widgets eliminados. Al salir de la revisión también
se invalida el token del widget eliminado. Expiración, timeout
y error invalidan el token; una nueva verificación correcta elimina el error.

**No se puede atribuir con certeza el fallo inicial real a uno de esos motivos**
solo por un widget verde y cero pedidos. El verde es la validación del cliente;
el servidor verifica además el token con su secreto, hostname y acción. Hace
falta observar el código y estado HTTP seguros del siguiente intento.

## Flujo corregido

- `recover` es una acción propia sin challenge: valida origen, cuerpo, capacidad,
  límites y replay. No llama a Siteverify, admisión global ni creación.
- Un replay ausente devuelve `200 {"found":false}`. La interfaz informa que aún no
  hay confirmación registrada, deja de sugerir consultas indefinidas y ofrece
  volver a revisión con una nueva verificación.
- Se conserva la misma clave, capacidad y selección original en sessionStorage.
  Ausencia en una consulta no demuestra que una petición anterior haya terminado:
  podría seguir ejecutándose. Un nuevo intento usa esa identidad, nunca una nueva
  reserva por el mero resultado ausente. No borrar sessionStorage para reintentar.
- Un replay existente devuelve su comprobante sin volver a consumir challenge ni
  crear otra reserva. Se mantienen los locks, unicidad, hash del payload y
  transacciones SQL existentes, incluidos los casos concurrentes.
- El carrito solo se descuenta después de validar un comprobante real. Un error
  conserva las unidades. Los rechazos definitivos previos de stock/precio siguen
  permitiendo revisar la selección; los errores inciertos preservan identidad.
- Un frontend nuevo contra la función antigua reconoce el rechazo de `recover`
  como incompatibilidad de despliegue y conserva el intento, sin convertirlo en
  creación ni eliminar su clave.

## Diagnóstico seguro

| Resultado | Significado / comprobación manual |
|---|---|
| CHALLENGE_REQUIRED, HTTP 403 | Falta token; no se consulta Siteverify ni se crea pedido. La UI nueva impide confirmar así. |
| CHALLENGE_EXPIRED, HTTP 403 | Siteverify indica token vencido o consumido; completar una nueva verificación y usar la misma clave. |
| CHALLENGE_REJECTED, HTTP 403 | Siteverify rechazó el challenge; verificar nuevamente, sin asumir éxito. |
| CHALLENGE_CONTEXT, HTTP 403 | Hostname o acción no coinciden; comprobar dominio autorizado del widget, hostname configurado y acción `demo-order`. |
| CHALLENGE_CONFIG, HTTP 503 | Siteverify rechazó el secreto configurado; revisar manualmente la pareja site key / secret. |
| CHALLENGE_UNAVAILABLE, HTTP 503 | Siteverify no respondió correctamente (red, timeout, HTTP o JSON); renovar token antes de reintentar. |
| FORBIDDEN, HTTP 403 | El origen del navegador no coincide exactamente con el permitido. Protocolo, hostname y puerto importan. |
| NOT_CONFIGURED, HTTP 503 | Falta configuración o el origen y hostname son incompatibles. |
| HTTP_REJECTED, con estado | Rechazo HTTP no reconocido, incluido un gateway 401; verificar despliegue/configuración de gateway sin desactivar protecciones del handler. |
| NETWORK_ERROR / TIMEOUT_ERROR | No se obtuvo respuesta utilizable. Un fallo CORS también puede aparecer como error de red opaco; no atribuirlo automáticamente a Turnstile. Consultar el mismo intento. |
| INVALID_RESPONSE | Respuesta no válida; no se inventa una confirmación ni se borra el intento. |
| RECOVERY_UNSUPPORTED, HTTP 400 | La Edge desplegada aún no reconoce la nueva acción. Actualizar la función antes de usar la recuperación nueva. |
| RATE_LIMITED, HTTP 429 | Se mantienen 6 solicitudes/hora por bucket y 60 creaciones/hora globales. Recuperar también consume límite por bucket. Esperar; no relajar ni resetear límites para probar. |

No se agregaron logs de solicitudes ni respuestas. Solo se traducen códigos
permitidos y estado HTTP; se descartan detalles crudos del proveedor, del gateway
y de excepciones. No compartir tokens, capacidades, payloads, datos personales,
archivos HAR ni capturas con cuerpos de solicitudes. Para diagnosticar, alcanza
con código seguro, estado HTTP, ruta y momento aproximado, sin parámetros.

## Actualización manual y prueba real

1. Revisar/aprobar el diff de PR #6. No reaplicar SQL ni tocar pg_cron, Storage o RLS.
2. El operador autorizado debe desplegar **solo la función actualizada**, primero:

   ```sh
   supabase functions deploy demo-orders --project-ref evlbfjvvljbkntlozokt --no-verify-jwt
   ```

   El gateway público ya previsto para esta función sigue protegido por el origen
   exacto, Turnstile, capacidad, validación estricta y límites. No cambiar otras
   funciones ni sus opciones JWT. No hay secretos nuevos.
3. Actualizar el frontend de esta misma rama. Para probar localmente: `npm ci` y
   `npm run dev`. Conservar las variables públicas y secretos existentes. Comprobar
   manualmente que la URL local coincide con el origen permitido: `localhost` y
   `127.0.0.1` no son intercambiables, ni lo son puertos diferentes. El hostname
   de Turnstile no incluye protocolo ni puerto. No imprimir secretos para comprobarlo.
4. Desde el carrito, completar revisión y esperar verificación. Confirmar debe
   permanecer deshabilitado hasta recibir token. Con éxito debe aparecer referencia
   real y recién entonces descontarse la selección local.
5. Si aparece error, anotar únicamente código seguro/estado HTTP. Si el resultado
   es incierto, consultar una vez. Si no existe, volver a revisión, verificar otra
   vez y confirmar **la selección original con la misma clave**. No alternar pestañas
   ni borrar almacenamiento. Si ya existe, mostrar su comprobante sin nueva reserva.
6. Verificar los contadores con las consultas de solo lectura del procedimiento
   existente. Cada pedido demo exitoso implica una única reserva por variante;
   no repetir cargas ni desactivar límites. La validación real queda pendiente del
   operador, ya que esta corrección no realizó solicitudes al Supabase remoto.

## Pruebas locales

Se añaden pruebas del hook, transporte, callbacks del widget y handler, más un
recorrido de navegador con token manual: token ausente, error de red, consulta
sin resultado, token consumido y reintento correcto con la misma identidad.
También se comprueba replay tras respuesta perdida y una única llamada de creación.
Las suites existentes conservan pruebas SQL de concurrencia, expiración y stock.
Los resultados finales de ejecución figuran en la PR; los escenarios de navegador
usan fixtures interceptados, sin escribir en Supabase.

## Diagnóstico posterior de la creación

Para el 503 de Siteverify informado después de esta corrección, ver
[Diagnóstico seguro de Siteverify y RPC](stage-5-siteverify-diagnostics.md).
Añade logs estructurados sin datos sensibles y un procedimiento de una sola
confirmación controlada; no requiere migraciones ni cambios de secretos.
