# Fotografías privadas: optimización opcional y aprobación manual

## Investigación y resultado

El bucket `product-images` sigue privado. El cliente anónimo obtiene URLs firmadas
por 900 segundos bajo las políticas existentes. Una comprobación de solo lectura
sobre una imagen publicada devolvió un PNG de 2.158.777 bytes. Firmarla con parámetros
de transformación (192 × 256, calidad 78) devolvió el mismo PNG y tamaño; no se presupone
que el proyecto tenga un servicio de transformación activo. No se cambió el bucket,
RLS, archivos ni metadatos remotos durante esta entrega.

El frontend ahora agrupa solicitudes de firma concurrentes y reutiliza URLs en memoria
por hasta 14 minutos, con un minuto de margen antes del vencimiento. No persiste tokens,
precios ni inventario en esa caché. Un error de imagen puede forzar una firma nueva.
La navegación y revalidación del carrito siguen consultando productos y variantes.

`Photo` declara dimensiones, reserva espacio, carga imágenes fuera de pantalla de forma
perezosa y muestra estados discretos. Si existe una versión WebP registrada la prefiere;
si falla, vuelve al original. Los originales funcionan mientras la carga opcional no se apruebe.
Las derivadas no se muestran como fotografías adicionales en la galería.

## Archivos preparados offline

`scripts/prepare-catalog-images.mjs` usa Sharp solo como dependencia de desarrollo y
verifica los hashes de los 12 PNG originales antes de generar 36 WebP, sin ampliarlos
ni cambiar su composición. Los archivos están en `supabase/seeds/optimized/`.

| Perfil | Uso | Límite de dimensiones | Calidad | Total de 12 archivos |
| --- | --- | --- | --- | --- |
| thumb | Carrito, aviso, miniaturas de galería | 240 × 360 | 78 | 59.846 bytes |
| card | Tarjetas de catálogo | 768 × 1152 | 82 | 730.922 bytes |
| detail | Imagen principal | 1280 × 1920 | 85 | 1.585.948 bytes |

Las dimensiones reales respetan la proporción original y figuran en `manifest.json`,
junto con las rutas, hashes SHA-256 y relación con el producto original. El conjunto
suma 2.376.716 bytes. Las miniaturas pesan aproximadamente un 99,8 % menos que los PNG.
Las fotografías fuente son las originales de demostración ya documentadas en el catálogo;
no se copiaron imágenes de otras tiendas. Ningún archivo de esta carpeta se incluye en el
bundle público de Vite.

Reproducir y comprobar **sin conectar con Supabase**:

```bash
npm ci
npm run images:prepare
npm run images:check
```

## Procedimiento pendiente: solo después de aprobar la carga

La política actual de lectura de Storage exige una fila de `product_images` con la ruta
exacta del objeto. Por eso subir WebP solamente no basta. Esta operación opcional requiere
aprobar **36 archivos nuevos y 36 filas nuevas de metadatos de imágenes**, manteniendo los
12 originales y los productos, variantes, precios y políticas existentes.

1. Revisar visualmente los WebP locales y `supabase/seeds/optimized/manifest.json`.
   Confirmar en el Dashboard el proyecto VANTA `evlbfjvvljbkntlozokt` y el bucket
   privado `product-images`. No usar otro proyecto ni hacer público el bucket.
2. Subir **únicamente los 36 `.webp`**, conservando exactamente la ruta relativa desde
   `supabase/seeds/optimized/` indicada en `records[].storage_path`. Por ejemplo:
   `vanta-demo-v1/remera-essential/front.png.vanta-thumb-v1.webp`.
   No subir manifiesto, README ni SQL. No seleccionar reemplazo/upsert: son rutas nuevas.
   Si una ruta ya existe, descargar y comparar su SHA-256 con el manifiesto: omitirla si
   coincide; detenerse si difiere. No borrar ni sobrescribir archivos para resolverlo.
3. Después de aprobar los metadatos, generar el archivo confirmado localmente
   (también funciona en PowerShell):

   ```bash
   npm run images:prepare -- --confirm-project=evlbfjvvljbkntlozokt
   ```

   Esto solo escribe `work/vanta-images-link-v1.sql`; **no ejecuta SQL ni sube archivos**.
   No requiere una clave administrativa. Si ese archivo existe con otro contenido,
   conservarlo para revisión y moverlo fuera de esa ruta antes de regenerar.
4. En **SQL Editor del proyecto confirmado**, pegar y ejecutar **todo el contenido**
   de `work/vanta-images-link-v1.sql`. No ejecutar `link-images.pending.sql`: su marcador
   de aprobación provoca intencionadamente un error. No editar manualmente ese marcador.
   El SQL es un único bloque `DO`, atómico y sin tablas temporales `ON COMMIT DROP`.
5. El bloque comprueba el bucket privado y MIME, las 12 relaciones originales, los
   36 objetos subidos y posibles conflictos de identidad. Si falta algo, aborta toda la
   inserción. Solo agrega metadatos nuevos; no contiene UPDATE, DELETE ni cambios de RLS.
   Se puede repetir: los identificadores deterministas y las comprobaciones evitan duplicados.
6. Revisar que `product_images` tenga 36 filas nuevas (48 en total si antes había solo
   12) y que las 12 fotos originales no hayan cambiado. Recargar la tienda y comprobar
   catálogo, ficha, miniaturas, carrito y navegación: las URLs siguen siendo privadas
   y firmadas, ahora con rutas `.webp` apropiadas para cada tamaño. Los derivados no
   aumentan el número de fotos visibles de la galería ni alteran los 12 productos.

Las pruebas SQL usan PostgreSQL local en memoria con las migraciones actuales: verifican
rechazo sin aprobación, archivos faltantes, atomicidad, repetición y lectura anónima con
RLS, sin ejecutarse contra el servicio remoto. Si se pospone esta aprobación, la tienda
continúa usando los PNG y la mejora de caché; no se promete la reducción de transferencia
hasta cargar y vincular los WebP. No hay paso remoto automático ni cambio de RLS pendiente.
