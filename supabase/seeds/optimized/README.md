# WebP privados preparados offline — no aplicar automáticamente

36 derivados de las 12 imágenes originales del catálogo demo VANTA, generados por
`scripts/prepare-catalog-images.mjs`. No reemplazan ni alteran los originales.
La procedencia de las imágenes originales se conserva en los archivos de demostración.

- `manifest.json`: rutas exactas, dimensiones, hashes y relaciones.
- `vanta-demo-v1/` y `vanta-demo-v2/`: solo los WebP, con tres perfiles por imagen.
- `link-images.pending.sql`: bloque deliberadamente bloqueado hasta aprobación;
  no editar ni ejecutar para eludir la confirmación.

Reproducir: `npm run images:prepare`. Verificar: `npm run images:check`.
Ningún comando conecta con Supabase. La carga requiere aprobación manual de los
archivos **y 36 metadatos nuevos** porque RLS verifica la ruta exacta del objeto.

Seguir [el procedimiento completo](../../../docs/catalog-image-optimization.md)
antes de subir o ejecutar SQL. No subir este README, el manifiesto o el SQL a Storage.
