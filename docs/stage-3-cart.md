# Etapa 3 — Carrito VANTA

Rama: `feat/stage-3-cart`, creada desde `main` con las etapas 1 y 2 integradas.
Esta entrega prepara la selección de prendas; todavía no permite comprar.

## Uso local

```bash
git fetch origin
git switch feat/stage-3-cart
npm ci
npm run dev
```

Abrir `http://localhost:5173`. Conservar la configuración pública existente de
Supabase en el entorno o `.env.local`: `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`. Si se crea el archivo por primera vez, usar
`.env.example` como referencia. Nunca usar claves administrativas en `VITE_*`.
No hace falta ejecutar seeds, migraciones ni modificar RLS.

1. Ir a Colección y abrir una ficha de producto publicado.
2. Intentar agregar sin seleccionar: debe pedir talle y color.
3. Elegir una combinación publicada y una cantidad entera de 1 a 10; agregar.
4. Repetir la misma combinación: debe acumular unidades en una sola línea.
5. Elegir otra combinación: debe quedar separada.
6. Abrir el ícono del encabezado o «Ver carrito» en la confirmación de la ficha.
7. Revisar imagen, nombre, talle, color, precio unitario, subtotal y total ARS.
8. Modificar cantidades, eliminar una línea y probar cancelar/confirmar el vaciado.
9. Recargar o cerrar y abrir el navegador en el mismo origen: la selección debe
   recuperarse y los precios deben consultarse nuevamente.
10. Cerrar con ×, Escape o clic en el fondo exterior en escritorio. Recorrer con
    Tab y Shift+Tab; el foco debe permanecer en el panel y regresar al acceso al
    cerrar. En móvil, abrir también desde el encabezado con el menú desplegado.

El carrito de `localhost:5173` es independiente del de otro dominio o puerto.
La persistencia depende de que el navegador permita almacenamiento local; si lo
bloquea, se informa y el carrito funciona en memoria durante la visita.

## Datos y validación

- `src/features/cart/model.ts`: reglas puras, validación, cálculo entero y
  recuperación. Clave `vanta.cart.v1`, esquema `{ version: 1, lines: [...] }`.
- Cada línea persistida contiene **solo** `slug`, `productId`, `variantId` y
  `quantity`. No se guardan precios, stock, imágenes firmadas ni credenciales.
- Se validan estructura, versión, identificadores, slugs, enteros, duplicados y
  límites. Datos corruptos se descartan con aviso. Campos monetarios inyectados
  se ignoran y se eliminan al volver a serializar.
- `CartProvider.tsx` mantiene el estado fuera de las rutas y sincroniza cambios
  de otras pestañas. Antes de agregar consulta otra vez el producto y verifica
  combinación activa y pertenencia de variante. Revalida al restaurar, abrir,
  modificar cantidades, recuperar conexión o volver a la ventana.
- Cada consulta completa tiene un máximo de 15 segundos. Se ignoran respuestas
  antiguas y una consulta pendiente no repone artículos después de vaciar.
- Si falla la consulta o desaparece un producto/variante, se conserva la intención
  de selección, se permite eliminar/reintentar y se muestra **Total por confirmar**.
  No se presenta un total parcial o un precio local como un importe verificado.
- Los importes se toman de `products.price_cents` en ARS. Multiplicación y suma
  usan centavos enteros seguros; solo el formato visual divide por 100.
- Máximo 10 unidades por variante y 30 variantes distintas. Se comunica como
  límite del carrito, **no como stock**. Siempre se mantiene «Stock por confirmar».
- `CartDrawer.tsx` usa un diálogo modal nativo: fondo inerte, foco contenido,
  restauración de foco, cierre con Escape y fondo exterior, scroll interior y
  controles táctiles de 44 px. La confirmación de vaciado enfoca «Cancelar».
- `AddToCart.tsx` agrega cantidad y mensajes de error/éxito a la ficha existente.
  `cart.css` conserva la paleta Dark Luxury y respeta movimiento reducido.

## Supabase y límites de confianza

Se reutiliza el servicio público existente: lecturas de `products`,
`product_variants`, `product_images` y categorías; firma de URLs privadas del
bucket `product-images` y renovación de imágenes mediante `Photo`. La firma usa
POST de Storage para obtener una URL de lectura; no sube ni modifica archivos.

No se consulta inventario privado ni se escriben productos, pedidos, reservas o
pagos. No se modifican RLS, migraciones, datos del catálogo ni fotografías.
El carrito y sus totales son una preparación visual, no una cotización garantizada.
Una futura compra deberá validar precios y disponibilidad **en servidor**, con
identificadores y cantidades, sin confiar en importes enviados por el navegador.

## Pruebas

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` ejecuta lint sin warnings, Vitest y build TypeScript/Vite. Vitest cubre
selecciones, agrupación/separación, cantidades, eliminación/vaciado, centavos,
persistencia, corrupción, versiones desconocidas, manipulación, red, productos
despublicados, almacenamiento bloqueado y respuestas asíncronas antiguas.

Playwright prueba la aplicación y el cliente Supabase existentes con respuestas
interceptadas de fixtures locales: **no requiere variables reales ni accede a
Supabase remoto**. Comprueba 1440×960, 375×812 y 320×640: compra futura
deshabilitada, variantes, cantidades, persistencia, errores, ausencia de escrituras,
sin desbordes, scroll interior, menú móvil, cierre, foco y movimiento reducido.
Capturas y trazas de fallos quedan en `work/playwright-results/`, sin versionar.
CI instala Chromium y ejecuta esta suite después de `npm run check`.

Para usar un Chromium ya instalado se admite `CHROMIUM_EXECUTABLE_PATH`; si no se
define, Playwright usa el navegador instalado por su propio comando. La revisión
automatizada no sustituye una comprobación adicional con lectores de pantalla y
Safari/iOS reales.

Comprobación real opcional de solo lectura: `npm run verify:supabase`, con las dos
variables públicas. En entornos cloud con proxy y Node 24 compatible, ejecutar
con `NODE_USE_ENV_PROXY=1` para respetar el proxy heredado. No muestra claves,
filas ni URLs firmadas. Resultado de esta entrega: 4 categorías, 12 productos,
12 imágenes y 96 variantes visibles; firma privada correcta.

Resultados de la entrega:

| Comprobación | Resultado |
| --- | --- |
| `npm run check` | Lint sin warnings, 167 pruebas aprobadas, build correcto |
| `npm run test:e2e` | 9 pruebas aprobadas en los tres tamaños de pantalla |
| Revisión con una prenda publicada real | Agregado de 2 unidades, imagen privada firmada, total y persistencia correctos en 1440, 375 y 320 px |
| Errores JavaScript / escrituras durante esa revisión | 0 / 0 |

La revisión con datos reales recibió las respuestas actuales de Supabase a través
del proxy TLS del entorno, sin desactivar la verificación de certificados. Las
pruebas automatizadas reproducibles usan exclusivamente los fixtures locales.

## Pendiente para la siguiente etapa

Checkout, datos personales, autenticación de clientes, pedidos, reservas,
validación autorizada de inventario, medios de pago y cotización definitiva en
servidor. «Continuar compra — próximamente» está deshabilitado y no genera
ningún pedido ni simula una compra completada.
