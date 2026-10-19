# Etapa 2 — Catálogo VANTA

## Bloque 1 — Conexión a Supabase

Basado en main actualizado tras la fusión de etapa 1. El frontend usa
`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Copiar `.env.example` a
`.env.local` (ignorado por Git) y completar la clave **publicable** real en privado.
La URL no es un secreto:

```dotenv
VITE_SUPABASE_URL=https://evlbfjvvljbkntlozokt.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
```

No pegar la clave en este documento, código, commits o PR. Las variables `VITE_*`
se incorporan al bundle y son visibles para el visitante; nunca usar una clave
`service_role` o `sb_secret_*`. Reiniciar Vite luego de configurar variables. En
un futuro despliegue habrá que configurarlas en el proveedor y volver a construir.
No se necesita ninguna clave privada del servidor para leer este catálogo.

Con las variables privadas ya configuradas, `npm run verify:supabase` realiza un
smoke test **solo de lectura**: cuenta filas visibles del catálogo y firma una
imagen si existe. No imprime claves, filas ni URLs firmadas. No se ejecuta en CI
para no exigir credenciales ni acceso al proyecto real. Si falla, revisar variables,
permisos/RLS y autorización de salida hacia el host del proyecto en el entorno.
El script requiere Node con soporte para `--experimental-strip-types` (Node 24 en
este proyecto); no escribe datos ni aplica migraciones.

`database.types.ts` describe exclusivamente las cuatro tablas públicas según las
migraciones existentes. Los servicios tipados solo exponen lectura de categorías,
productos, imágenes y variantes, con filtros explícitos `active=true`, filtros de
categoría/slug y paginación de 12 productos. RLS sigue siendo la autoridad para
ocultar categorías/productos desactivados. No se leen inventario ni datos privados.
No se modifica ninguna política ni migración de etapa 1.

El cliente de tienda no persiste sesiones, no restaura tokens de administrador ni
procesa enlaces Auth. Así la tienda pública no hereda permisos de una sesión
administrativa del mismo navegador. No hay registro ni login de clientes.

Las imágenes del bucket privado se firman por lote con vencimiento de 15 minutos.
`createSignedUrls` usa POST para autorizar URLs de lectura: no sube imágenes ni
modifica datos. No usar `getPublicUrl` ni cambiar el bucket a público. Al fallar
una imagen se intenta renovar una vez la URL; la galería permite reintentar
manualmente. No se almacenan URLs firmadas en localStorage. Si Storage falla,
el catálogo conserva precios/textos y muestra un placeholder explícito.
Una URL ya firmada puede seguir funcionando hasta vencer aunque se oculte el
producto: limitación propia de URLs firmadas, no confirmación de disponibilidad.

## Bloque 2 — Diseño Dark Luxury

Header con logo, navegación móvil expandible y cuatro categorías, hero fotográfico
original, sección de categorías, catálogo de tarjetas con fondos y marcos,
manifiesto y footer. Negro, grafito y blanco cálido; tipografía sans para jerarquía
y serif editorial en titulares. Imagen integrada al encuadre, sin recortes flotantes.

`public/images/vanta-editorial.webp` es una imagen generada con IA para VANTA,
sin marcas, optimizada a WebP. No se copiaron fotografías de Brutto ni otras
marcas. No representa un artículo real del catálogo. Las imágenes de productos
se cargan desde Storage; no se reemplazan automáticamente por imágenes ajenas
ni por artículos ficticios si la base está vacía.

Navegación por enlaces hash (`#/`, `#/catalogo`, `#/categoria/remeras`,
`#/producto/slug`) con historial del navegador y enlaces directos, sin necesidad
de reglas de reescritura del servidor. Hay enlace para saltar al contenido,
foco en main al cambiar de ruta, foco visible, Escape en menú móvil, nombres
accesibles para galería, selección con `aria-pressed` y reducción de movimiento.

El footer identifica tienda, domicilio y email como ficticios; Instagram y
WhatsApp enlazan a sus plataformas, no a cuentas/números inventados que pudieran
pertenecer a terceros. Reemplazar solo con canales autorizados cuando existan.

## Bloque 3 — Catálogo funcional y validación

Catálogo por categoría, paginación, estados de carga/error con reintento/vacío,
producto individual con galería, precio ARS en centavos y selección de talle/color.
Al cambiar de color se limpia un talle incompatible y se deshabilitan combinaciones
no publicadas. No se muestra “agotado” por una simple ausencia de variantes.

**Disponibilidad:** el esquema actual no permite leer inventario públicamente.
Una variante activa solo acredita que está publicada; se muestra “stock por
confirmar”, nunca “en stock” ni cantidades inventadas. Para publicar disponibilidad
real hará falta más adelante un contrato de backend autorizado que exponga solo
un booleano calculado, sin dar acceso directo a inventario ni prometer reservas.
No se abrió ese acceso ni se incluyó una migración adicional en esta etapa.

**Transferencias:** no hay precio específico ni regla de descuento publicada en
la base. Se informa “Precio por transferencia: a confirmar. No hay un descuento
publicado.” No se calcula un porcentaje ni se anuncia un precio inventado.

`supabase/seeds/catalog.example.sql` prepara ahora ocho productos de demostración,
64 variantes e inventario ficticio, junto con ocho fotografías originales generadas
con IA. No se ejecuta automáticamente ni se ha cargado en remoto. La fuente está en
`supabase/seeds/catalog.demo.json`. El procedimiento de aprobación, carga separada
de Storage, controles de colisiones y repetición sin reponer stock se documenta en
[demo-catalog-load.md](demo-catalog-load.md). No ejecutar sin aprobar previamente
el destino VANTA. No modifica RLS ni habilita lectura pública del inventario.

Comandos de revisión:

```bash
npm ci
npm run check
```

Las pruebas cubren UI/rutas, reintento, categorías ocultas, formato ARS,
combinaciones, URLs privadas, servicios HTTP con respuestas simuladas y las
pruebas SQL/RLS heredadas. Los mocks están exclusivamente en pruebas; la tienda
no tiene modo demo automático ni usa fixtures como fallback de producción.

No incluye carrito, checkout, pagos reales ni panel. No despliega, no fusiona a
main, no ejecuta migraciones ni inserta datos remotos. Ver `stage-2-review.md`
para resultados de comprobaciones y límites de verificación real.
