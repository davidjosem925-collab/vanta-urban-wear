# Revisión posterior a PR #8: pruebas del checkout y portabilidad

Base: `main` en `bfe483c`; rama `fix/main-checkout-tests`.

## Causas reproducidas

El checkout tiene dos recorridos deliberadamente distintos. Sin pedidos habilitados,
«Finalizar demostración» termina el recorrido local sin crear reservas ni vaciar el
carrito. Con pedidos habilitados, «Confirmar pedido demo» exige Turnstile y una
respuesta válida del servidor; recién entonces descuenta del carrito las unidades
confirmadas. No corresponde sustituir un botón por otro en las expectativas.

En este entorno, `npm run check` sobre main pasó las 415 pruebas. Con variables
públicas ficticias, `VITE_DEMO_ORDERS_ENABLED=true` y una site key ficticia se
reprodujeron estas tres fallas en `Checkout.test.tsx`:

1. «conserva memoria al volver y navegar, finaliza sin vaciar ni persistir datos personales».
2. «la recarga conserva el carrito, pierde PII y no permite falsificar una finalización».
3. «revalida precio/variante y bloquea la finalización ante error o despublicación».

Las tres usaban el servicio de pedidos predeterminado de `App`, heredando las
variables del desarrollador, aunque el catálogo sí era una fixture. Esperaban el
recorrido local, pero estaban montando el recorrido con pedidos.

Al convertir temporalmente las dos plantillas SQL a CRLF y mantener ese entorno,
se reprodujeron exactamente **cinco fallas en tres archivos**. Las otras dos:

4. `demo-generator.test.ts`: «genera la ampliación explícita con solo cuatro productos y conserva la plantilla completa».
5. `demo-seed.test.ts`: «ejecuta la carga como una sentencia autónoma y el resumen en otra petición sin estado de sesión».

Comparaban texto generado LF contra archivos de checkout CRLF byte a byte. También
`demo:check` tenía esa dependencia. Las plantillas carecían de una regla `eol=lf`.
No había diferencias de sentencias, productos ni integridad de imágenes.

La reproducción controlada en Linux dio **5 fallidas / 21 aprobadas** sobre esos
26 casos. En Windows ya existe una prueba omitida de enlaces simbólicos, que
requieren permisos adicionales; esto es coherente con el total reportado
409/5/1. No se afirma haber ejecutado Windows localmente: se agrega CI en Windows
para comprobarlo allí.

## Correcciones

- La suite local de checkout inyecta explícitamente un `OrderService` deshabilitado,
  con métodos que fallan si se intenta crear o recuperar un pedido inesperadamente.
  No se cambia ninguna configuración ni lógica de producción.
- Dos pruebas integradas adicionales ejercitan el servicio habilitado simulado:
  sin challenge no se confirma; un recibo válido vacía las unidades confirmadas;
  el rechazo `PRICE_CHANGED` conserva el carrito y requiere otra verificación.
- Playwright declara explícitamente el modo sin pedidos para las suites generales
  y de correo administrativo. La suite `orders` conserva su modo habilitado.
- Generador y pruebas reutilizan `sameGeneratedText`, que admite únicamente LF/CRLF.
  BOM, espacios, contenido cambiado y salto final ausente siguen siendo errores.
  La preparación no reescribe archivos equivalentes ni cambia su fecha.
- Se agregan `eol=lf` para ambas plantillas, ocho regresiones de archivos SQL y CI
  Linux/Windows Node 22.20 con pedidos/correo habilitados, credenciales ficticias,
  verificación del seed y comprobación de que preparar no altera archivos versionados.

## Checkout, reservas y autorización

Se revisaron `CheckoutPage`, `App`, `useDemoOrder`, el servicio de pedidos y las
funciones SQL de creación/resolución. El precio esperado procede de la selección
revalidada, pero PostgreSQL verifica el precio actual, productos activos y stock,
bloquea inventario en orden determinista y crea pedido/reservas atómicamente.
La idempotencia y la capacidad se conservan ante respuestas inciertas; recuperación
no implica crear un pedido. Cancelación/vencimiento liberan solo reservas activas;
confirmación no puede consumir después del plazo de servidor. El carrito solo
se modifica tras un recibo validado y preserva agregados durante la solicitud.

No se encontraron defectos de producción asociados a las cinco fallas. No se
cambia checkout, validación de precios, stock, Turnstile, límites, SQL de seguridad,
Magic Link, contraseña, sesiones, RLS ni permisos administrativos.

## Verificación

Los resultados finales se registran en la PR. La reproducción posterior con las
mismas variables ficticias y plantillas CRLF pasó **36/36** pruebas (incluidas diez
regresiones nuevas); `demo:check` también pasó para 12 productos/96 variantes.

Las pruebas de navegador interceptan APIs; las pruebas PostgreSQL/Auth usan
servicios locales descartables. No prueban el estado del Supabase alojado, SMTP,
la entrega real de enlaces ni Cloudflare real. No es necesario aplicar SQL,
configurar secretos ni desplegar servicios para esta corrección.

Para revisar localmente:

```sh
npm ci
npm run check
npm run demo:check
npm run images:check
npm run test:e2e
npm run test:e2e:admin-email
npm run test:e2e:orders
```

Las suites de navegador inician sus propios servidores y usan fixtures; no apuntan
al catálogo remoto. Las integraciones `test:admin:auth`, `test:admin:email` y
`test:admin:passkeys` requieren Docker local; `test:orders:postgres` exige
`VANTA_TEST_PG_CONTAINER` apuntando exclusivamente a un PostgreSQL descartable.
No usar un contenedor con datos existentes.
