# Etapa 8 · Fase 3: checkout de pagos de prueba

Implementación en `feat/stage-8-payments-email`, misma PR #10. Sin cambios remotos,
servicios desplegados, cobros productivos ni envío de correos.

## Recorrido y autoridad

Con el flag público desactivado se conserva el checkout anterior. Con el flag
activado, Mercado Pago es la primera opción y queda preseleccionado; transferencia
ficticia es la segunda. Efectivo continúa soportado en el backend legacy, pero no
se ofrece en este recorrido. Se conservan formulario, validaciones, resumen
responsive de prendas/variantes/unidades/importes y Turnstile de un solo uso.

1. `demo-orders` crea o recupera el pedido con la misma clave de idempotencia.
   Valida catálogo, precios y límites; reserva por los 60 minutos existentes.
2. Antes de descartar ese intento o retirar las unidades confirmadas del carrito,
   se guarda una sesión de recuperación de pago en **sessionStorage**, en la
   misma pestaña. Incluye referencia, capacidad e intento original validado. No
   guarda datos de contacto/domicilio, token Turnstile, Access Token, URL de
   checkout ni un estado de pago que pudiera reutilizarse como prueba.
3. Mercado Pago llama a `mp-checkout` con **solo** acción, referencia y capacidad.
   El cuerpo no incluye precios, productos, datos personales ni estado financiero.
   El backend de fase 2 conserva snapshots, identidad del vendedor de prueba,
   idempotencia, leases, eventos, verificación de importes y conciliación.
4. Solo una URL exacta del checkout argentino con ID `ORDTST…` puede redirigir.
   Se utiliza la misma pestaña: la capacidad nunca viaja en URLs, query strings ni
   enlaces de Mercado Pago. El navegador no solicita tarjetas o datos bancarios.
5. Todos los retornos nuevos llevan a `/#/checkout/pago`. Un retorno no acredita
   nada: se consulta la misma operación al servidor y se muestra por separado
   estado financiero y del pedido. Parámetros como `status=approved` se ignoran.
   Pedidos existentes conservan su request congelado; sus rutas antiguas de
   retorno también conducen a la consulta cuando existe la sesión privada.
6. Recargar recupera **sin crear otro pago ni otra reserva**. Las consultas son
   manuales, con una consulta inicial por carga y sin polling/reintentos en bucle.
   Se conserva el límite compartido de seis solicitudes/hora del servidor y se
   separan las consultas manuales por al menos diez segundos. Recargar no evade
   el límite. Un 429 pide esperar y nunca se interpreta como aprobación.
7. Si el servidor informa que todavía no existe una operación MP, el usuario
   puede iniciarla explícitamente sobre la **misma referencia y capacidad**. Una
   respuesta perdida no se convierte en éxito ni en una nueva clave.
8. La reserva vencida/cancelada no se reactiva. Una acreditación tardía en `review`
   se presenta como revisión administrativa, sin volver a pagar ni consumir
   inventario liberado. Solo un estado terminal verificado permite dejar atrás
   esa sesión mediante «Preparar otra selección». Navegar al catálogo conserva
   el acceso a la operación pendiente.

Las unidades se retiran del carrito después de la confirmación del **pedido**,
no se presenta eso como pago aprobado. Agregados concurrentes al carrito se
preservan. Mientras existe una sesión pendiente no se habilita otra confirmación
desde el checkout de esta pestaña.

## Transferencia ficticia

El mismo pedido reservado utiliza `demo-orders`, acción `transfer`, para preparar
o recuperar un único registro `payments.method=bank_transfer`, con total del
pedido y estado inicial `pending`. Bloquea la fila del pedido antes de preparar;
repetir no inserta otra fila ni reserva. Requiere capacidad correcta y modalidad
`transfer`, pasa los mismos controles de origen y límites, y no necesita secretos
Mercado Pago. No acepta importes/estados en el body ni una acción de aprobación.

La RPC `demo_transfer_payment` es `SECURITY DEFINER` con search_path vacío y
EXECUTE exclusivo de service_role; no habilita DML directo ni permisos de usuario
anónimo/autenticado. Los administradores continúan usando Auth y sus RPC actuales.
El vencimiento/cancelación de una transferencia impaga se refleja al consultar,
sin sobreescribir evidencia de pagos aprobados/reintegrados. No se marca pagada
por confirmar el pedido. La gestión financiera administrativa/auditable ampliada
queda para la fase 5; esta fase no crea un botón de «pagué» ni acepta comprobantes.

Se muestran **Banco ficticio VANTA**, **Tienda ficticia VANTA** y
**NO-TRANSFERIR-DEMO**, indicado expresamente como identificador de muestra que
**no es un alias bancario**. No hay CBU, CVU, alias ni cuenta real. Se indica
«No transfieras dinero» y no se abre ninguna pasarela para transferencia.

## Activación manual (no ejecutada)

1. Revisar/aprobar la [guía del backend](stage-8-payments-backend.md), su migración
   `202610230001_mp_test_backend.sql` y las comprobaciones de fase 2. No reaplicar
   migraciones registradas ni ejecutar db push sin revisar el historial.
2. Revisar/aprobar y aplicar **solo si falta**
   `supabase/migrations/202610230002_checkout_payments.sql`. Reemplaza la función
   de preparación MP únicamente para futuras URLs de retorno y agrega la RPC de
   transferencia. No actualiza registros históricos, requests congelados, stock,
   precios, usuarios, RLS ni la duración de reservas.
3. Tras aprobación, desplegar la versión actual de `demo-orders` (agrega acción
   transfer). Conservar sus cuatro secretos/Turnstile existentes. Las tres
   funciones MP, sus secretos, worker y webhook se configuran como en fase 2.
   No copiar ninguna credencial privada a archivos `VITE_`.
4. Verificar los dos flags **servidor** (`MP_CHECKOUT_ENABLED` y config SQL) y
   vendedor/aplicación de prueba. Solo entonces construir la web con:

   ```dotenv
   VITE_SUPABASE_URL=https://<PROYECTO_VERIFICADO>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<CLAVE_PUBLICA>
   VITE_DEMO_ORDERS_ENABLED=true
   VITE_TURNSTILE_SITE_KEY=<CLAVE_PUBLICA_DEL_WIDGET>
   VITE_MP_CHECKOUT_ENABLED=true
   ```

   Son variables públicas de build; el flag no autoriza operaciones en Supabase.
   No usar Access Token, webhook secret ni service-role en React. No cambiar flags
   de acceso administrativo, SMTP, Magic Link o contraseña.
5. Probar la integración alojada con **origen HTTPS de pruebas** coincidente con
   `MP_ALLOWED_ORIGIN` y configuración actual de `DEMO_ALLOWED_ORIGIN`/Turnstile,
   siguiendo aprobación manual. Fase 2 exige HTTPS; no se relajó para aceptar
   HTTP local. No inventar un dominio definitivo. Mantener los redirects en
   `config.online`, no en Preferences/back_urls. Las URLs se derivan en SQL del
   origen aprobado y no se reciben del navegador.
6. Ejecutar una compra controlada con comprador/tarjeta **de prueba**. Verificar
   retorno pendiente antes de webhook, aprobación tras GET verificado, un solo
   pago y consumo, regreso tras cancelar y recuperación recargando. Probar
   transferencia sin realizar transferencia real. No alterar fechas de pedidos
   ni inventario alojado para acelerar vencimientos. Consultas read-only:

   ```sql
   select has_function_privilege('anon','public.demo_transfer_payment(uuid,text)','EXECUTE') as anon_exec,
          has_function_privilege('authenticated','public.demo_transfer_payment(uuid,text)','EXECUTE') as user_exec,
          has_function_privilege('service_role','public.demo_transfer_payment(uuid,text)','EXECUTE') as service_exec;
   -- Esperado: false / false / true.
   select method,status,count(*) from public.payments group by method,status;
   -- Complementar con supabase/operations/stage-8-verify.sql.
   ```

El flag por defecto es false: la implementación no activa pagos remotamente ni
convierte automáticamente la tienda en productiva. No hay correos en esta fase.

## Prueba local reproducible sin servicios remotos

```sh
npm ci
npm run check
npm run test:e2e:payments
npm run test:e2e
npm run test:e2e:orders
npm run test:e2e:admin-email
npm audit
```

Instalar Chromium con `npx playwright install chromium` si hace falta. La suite
`payments` inicia Vite con flags de pruebas y **todos** los servicios externos
interceptados por Playwright: no usa credenciales reales, no llama MP/Turnstile/
Supabase reales y no compra. Cubre 1440, 820, 375, 393 y 320 px. Capturas generadas
en `work/payment-pending-*.png` y `work/transfer-*.png` (artefactos ignorados).
No confundir esas capturas con una compra sandbox auténtica.

El harness `npm run test:payments:postgres` requiere un contenedor **local y
descartable** en `VANTA_TEST_PG_CONTAINER`; no admite un DSN remoto. Incluye
concurrencia de preparación de transferencia y carrera consulta vs cron de
vencimiento, además de los escenarios MP de fase 2. Se restaura el esquema en la
base descartable para comprobar reversión sin borrar datos reales.

## Reversión

Desactivar `VITE_MP_CHECKOUT_ENABLED` y reconstruir antes de revertir la UI. No
eliminar sesiones privadas ni registros para «limpiar» intentos pendientes. Si hay
operaciones MP en vuelo, mantener webhook, worker, credencial de prueba y cron de
expiración hasta conciliarlas; seguir el apagado operativo de fase 2.

Si se decide retirar solo fase 3, revisar/aprobar
`supabase/operations/stage-8-checkout-rollback.sql` y desplegar el handler anterior
de `demo-orders` coordinadamente. Restaura la generación anterior de URLs y retira
solo la RPC nueva, sin borrar pagos, eventos, pedidos ni reservas. Las requests MP
congeladas no se reescriben en ninguna dirección: conservar la pantalla de
consulta hasta que no existan operaciones en vuelo. No ejecutar el rollback
completo de fase 2 con actividad; dicho script se niega a hacerlo.

## Límites de la evidencia

Pruebas de frontend con servicios simulados, PGlite SQL real, PostgreSQL nativo y
Auth local se informan con resultados exactos en la PR. **No validado aún:**
credenciales concretas, navegación Checkout Pro auténtica, medios habilitados,
URLs de retorno admitidas por MP para el origen elegido, firma/webhook real,
worker alojado y contrato efectivo Orders API en Supabase/Deno. La integración
falla cerrada ante un contrato incompatible.

La recuperación está limitada a la pestaña/navegador originales. Si se cierra la
pestaña, se borra su almacenamiento o se vuelve desde otro dispositivo, no se
inventa una identidad desde la URL ni se consulta por referencia pública. Hace
falta revisión autorizada del administrador; no se debe repetir el pago para
«recuperarlo». No se implementó una cuenta de comprador ni enlace de recuperación
por correo; corresponde a las fases siguientes.
