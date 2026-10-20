# Etapa 4 — Checkout de demostración

Rama `feat/stage-4-checkout`, desde `main` actualizado con etapas 1–3 y la
corrección de seguridad de Vitest ya integradas. PR en borrador para revisión;
no se fusiona automáticamente.

## Flujo y rutas

Catálogo → ficha → carrito → **Continuar al checkout demo** → datos, entrega y
pago simulado → revisión → **Finalizar demostración** → pantalla final.

| Ruta hash | Comportamiento |
| --- | --- |
| `#/checkout` | Formulario y resumen de la selección compartida |
| `#/checkout/revision` | Contacto, dirección si corresponde, método simulado y selección; permite volver a editar |
| `#/checkout/finalizado` | Finalización solo después de revisar/validar en esta sesión; no crea pedidos ni cobra |

Carrito vacío: pantalla con enlace a la colección; no hay avance ni finalización.
Acceder directamente a revisión/finalización no evita las validaciones. Recargar
la aplicación conserva el carrito y recupera precios/variantes desde el catálogo,
pero pierde el formulario y la finalización en memoria: hay que completar nuevamente
los datos. No hay números de pedido, correos, WhatsApp, links de cobro ni reservas.
Finalizar **no vacía el carrito**. La selección puede revisarse, modificarse o
seguirse explorando desde las acciones y la navegación existente.

## Arquitectura y persistencia

- `src/features/checkout/model.ts`: borrador tipado, validaciones puras, provincias,
  métodos simulados y transición de entrega. No representa un pedido ni contiene
  precios, stock, credenciales o una estructura de pago real.
- `CheckoutPage.tsx`: formulario, revisión, resumen y finalización. Reutiliza
  `CartProvider`, `Photo` con perfil `thumb`, URLs privadas firmadas y `formatARS`.
- `AppShell` conserva el borrador **en memoria**, fuera del contenido de ruta que
  se remonta al navegar. Se mantienen datos al retroceder/avanzar, volver al catálogo
  o abrir el carrito. No se agrega otro proveedor ni un carrito duplicado.
- No se escribe PII en localStorage, sessionStorage, URLs, logs o Supabase. El
  esquema persistente del carrito `vanta.cart.v1` queda intacto: identificadores
  y cantidades. Se invita a usar datos ficticios y se explica la pérdida al recargar.
  El autocompletado del navegador sigue siendo una preferencia propia del usuario.
- La página del checkout se carga con `React.lazy`/`Suspense`, sin dependencias
  nuevas y sin cargar su JavaScript completo en la portada inicialmente.
- Al entrar o cambiar de paso se llama al `refresh` existente del carrito. Se
  mantienen también sus revalidaciones de cantidades, foco, conexión y restauración.
  Los precios se leen del catálogo y se calculan con centavos enteros ARS; no se
  duplican ni confían importes persistidos. Una selección pendiente, no publicada
  o con error bloquea el avance y muestra acciones para reintentar o editar.

## Formulario y validación

Contacto obligatorio: nombre/apellido de 2–60 caracteres, email válido hasta 254,
teléfono de 8–15 dígitos con código de área (se permiten separadores y prefijo +).
Errores en español junto al campo, `aria-invalid`, `aria-describedby`, resumen de
errores anunciado y foco en el primer campo inválido. Los demás datos no se borran.
Se usan labels, tipos email/tel y atributos de autocompletado adecuados.

Entrega:

- **Envío:** provincia argentina, localidad (2–80), código postal de cuatro dígitos
  o CPA, calle (2–100) y altura (número o S/N). Piso/departamento hasta 40 caracteres
  e indicaciones hasta 300, opcionales. No se cotiza ni se suma un cargo de envío.
  Se muestra «Envío a coordinar. El costo de envío no está incluido en el subtotal.»
- **Retiro:** local expresamente ficticio/de demostración y sin costo; no se piden
  campos de dirección ni se inventan dirección u horarios reales.
- Cambiar de entrega conserva el contacto y la dirección previa en memoria por si
  se vuelve a envío. Una dirección oculta no se exige ni se muestra para retiro.

Métodos: Mercado Pago — Demo, Transferencia bancaria — Demo y Efectivo — Demo.
Son selecciones visuales: no contienen SDK, claves, formularios financieros,
cuentas/alias, comprobantes ni enlaces de pago. Efectivo está deshabilitado para
envío; pasar de retiro/efectivo a envío limpia el método y lo comunica de forma
accesible. La validación también rechaza esa combinación, aunque se altere el estado.

El resumen es el carrito actual: imagen WebP optimizada cuando existe, nombre,
talle/color, cantidad, precio unitario, subtotal por variante y subtotal general,
entrega y método simulado. No se presenta ese subtotal como total definitivo con
envío incluido. Se mantiene **Stock por confirmar** y no se afirma disponibilidad.

## UX y responsive

Negro/carbón, blanco hueso, grises y los botones/tipografía existentes. Indicador
semántico de pasos, breadcrumbs y foco de navegación compartido. Escritorio con
formulario a la izquierda y resumen a la derecha, sticky y con scroll propio si
fuera largo; hasta 1000 px pasa a una columna. Resumen desplegable con `details`
nativo y abierto inicialmente. Controles de al menos 48 px y campos de una columna
en celulares pequeños, con entradas de 16 px para evitar zoom automático de iOS.
Acciones finales después de toda la revisión/selección.

La barra flotante del carrito no se renderiza en **ninguna ruta de checkout**; el
ícono del encabezado y los botones del checkout siguen abriendo el panel existente.
No hay acciones pegadas sobre el formulario. Se conservan modales y guías de talles,
Escape, contención/restauración de foco y preferencias de movimiento reducido.

## Seguridad y separación de etapas

Solo lecturas públicas y firma de URLs con el cliente existente. No se ejecutan
seeds, migraciones, SQL remoto, cargas de Storage ni escrituras comerciales. Las
migraciones ya incluyen estructuras previstas para pedidos/pagos/inventario; esta
etapa **no las usa ni modifica**, ni cambia RLS, catálogo, fotografías o precios.

Los estados, validaciones y subtotales de esta página son una demostración local,
no una autorización comercial. **Etapa 5:** validación de precio/stock en servidor,
creación segura e idempotente de pedidos, entrega cotizada, estados, reservas y pagos,
con las aprobaciones/diseño correspondientes. **Etapa 6:** administración de
productos, fotografías, variantes, stock y pedidos. No se implementa ninguna de
esas operaciones de forma anticipada ni se expone una clave administrativa.

## Ejecutar y revisar localmente

```bash
git fetch origin
git switch feat/stage-4-checkout
git pull --ff-only origin feat/stage-4-checkout
npm ci
npm run dev
```

Abrir `http://localhost:5173`. Conservar las variables públicas actuales
`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en el entorno o `.env.local`;
no hacen falta seeds, migraciones, claves de servicio ni cargas adicionales.

1. Agregar una prenda publicada con talle/color/cantidad y abrir el carrito.
2. Continuar al checkout demo. Intentar revisar sin completar; comprobar errores
   y foco. Completar con **datos ficticios**.
3. Comparar envío frente a retiro, incluidas dirección condicional y selección de
   efectivo incompatible. Revisar que no aparezca una tarifa inventada.
4. Ir a revisión, volver a editar y abrir el carrito; cambiar cantidades o quitar
   prendas y comprobar que el resumen es el mismo. Probar vaciar y volver al catálogo.
5. Finalizar la demo: aviso sin cobro/pedido, carrito conservado. Recargar:
   el formulario se pierde y no se puede reproducir una finalización por URL.
6. Revisar los anchos 320, 375, 393, 820 y 1440 px, navegación/menú, teclado, resumen
   desplegable, desplazamiento y ausencia de superposiciones o desbordes.

## Pruebas

```bash
npm run check
npx playwright install chromium
npm run test:e2e
npm audit
```

Vitest cubre validaciones, cambio de entrega, efectivo incompatible, error accesible,
memoria entre pasos y rutas, pérdida del borrador al recargar, persistencia del
carrito, coherencia de precios, variantes no publicadas y finalización sin vaciado.
Se mantienen las pruebas anteriores de catálogo, carrito, imágenes, guías y SQL
**local en memoria**. Los escenarios Playwright comparten un fixture HTTP extraído
de la suite existente; bloquean escrituras de base de datos y cualquier destino
remoto inesperado, incluidos pagos. Comprueban además que no se persista PII.

Capturas de formulario de envío/retiro, revisión y finalización en
`work/playwright-results/`, sin versionar; los nombres incluyen el ancho/proyecto.
Puntos para aprobación visual: proporción de columnas y resumen sticky, altura y
contraste de campos, legibilidad de avisos demo, revisión móvil y pantalla final.

Resultados de la entrega (reproducidos también por CI):

| Comprobación | Resultado |
| --- | --- |
| ESLint | Sin errores ni warnings |
| Vitest | 228 pruebas, incluidos 31 casos nuevos de checkout |
| TypeScript / build | Correctos; checkout separado en chunk de carga diferida |
| Playwright | 45 recorridos en 1440, 820, 393, 375 y 320 px |
| `npm audit` | 0 vulnerabilidades |
| Tráfico en los recorridos válidos | Sin escrituras de base de datos ni destinos remotos inesperados |

El fixture compartido bloquea cualquier destino externo que no sea el host falso de
Supabase y solo admite sus lecturas/firma simuladas. No se cargaron datos remotos.

Las pruebas automatizadas no reemplazan una revisión adicional en Safari/iOS real
y con un lector de pantalla.
