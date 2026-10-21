# Refinamiento UX del administrador (PR #7)

## Qué cambia

Se conserva Auth/MFA, AAL2, RLS, Storage privado y todas las RPC de etapa 6.
No hay migración adicional, cambios de datos remotos ni nuevos secretos.
La activación original sigue documentada en [stage-6-admin.md](stage-6-admin.md).

- Productos: listado compacto con fotografía firmada cuando existe, categoría,
  precio ARS y estado. Búsqueda, publicación y página permanecen en la URL.
- Editor: Información general, Fotografías, Talles y colores, Control de stock y
  Revisión. Solo se muestra la sección elegida. Los formularios permanecen
  montados dentro del mismo producto para conservar sus cambios entre secciones.
- Alta: guardar borrador, agregar fotos, combinaciones, stock y revisar/publicar.
  La dirección se genera del nombre; si hay una colisión, se puede elegir otra.
  Editar prendas existentes conserva su slug. El estado inicial siempre es borrador.
- Combinaciones: elegir color, marcar talles y revisar nuevas combinaciones. Se
  conservan los códigos existentes; los nuevos se generan automáticamente.
  Cada llamada crea combinación e inventario cero atómicamente mediante la RPC
  existente. El lote no es una única transacción: si falla parcialmente, informa
  lo confirmado, consulta datos y no reintenta escrituras automáticamente.
- Stock: consulta por producto/color/talle; formulario corto Agregar/Quitar, motivo,
  vista previa y confirmación. La RPC valida el stock actual, las reservas y la
  identidad del intento. Las cantidades de la vista previa no son una promesa de
  disponibilidad. El historial desplegable muestra hasta 30 movimientos del producto.
- Fotos: principal identificada, orden accesible por botones, descripciones, avance
  por archivos y retiro sin borrar Storage. Las versiones WebP y límites no cambian.
- Pedidos demo: estados/modalidades en español, datos históricos y reservas de
  solo lectura. No se añaden pagos ni cambios manuales de estado.

## Fallos investigados

1. **Pérdida de contexto al volver a la pestaña.** El callback Auth llevaba el
   estado a `loading` ante `SIGNED_IN`, aunque correspondiera al mismo usuario ya
   verificado. Eso desmontaba Workspace, cuyas selección y sección eran locales.
   Ahora los eventos de la misma identidad conservan el área montada mientras se
   revalida en servidor; una sesión ausente, usuario diferente, membresía revocada
   o nivel inferior vuelve a cerrar el acceso. El SDK no ejecuta consultas dentro
   de su callback bloqueado. No se confía en el guard del navegador para autorizar.
2. **Éxito y error contradictorios.** Guardado, `onSaved`, cambio de componente y
   `reload()` compartían un flujo: el alta perdía su aviso al cambiar la key y un
   error posterior de consulta se presentaba como fallo de escritura. Se conserva
   la confirmación del servidor y se muestra una advertencia de consulta separada.
   Reintentar consulta nunca repite una escritura. Un alta de respuesta incierta
   consulta su dirección antes de permitir otro intento; la unicidad sigue en SQL.
3. **Edición concurrente.** Se mantienen timestamps/snapshots esperados. Un conflicto
   conserva el formulario y permite consultar/adoptar explícitamente la versión
   guardada; no se actualiza silenciosamente el token de concurrencia.

## Navegación y cambios pendientes

- `/#/admin` continúa siendo una entrada válida.
- `/#/admin/productos?buscar=…&estado=draft&pagina=0`
- `/#/admin/productos/nuevo/general`
- `/#/admin/productos/<UUID>/general` (también fotos, talles, stock, revision)
- `/#/admin/stock` y `/#/admin/stock/<UUID>`
- `/#/admin/pedidos` y `/#/admin/pedidos/<UUID>`

Las rutas restauran producto y sección al recargar, incluso después de login/MFA.
Atrás/Adelante funcionan con el router hash existente. Pasar entre secciones del
mismo producto conserva los formularios sin guardar. Al abandonar ese contexto,
cerrar sesión o recargar, se solicita confirmación si hay cambios pendientes.
Aceptar descartarlos los elimina; no se promete recuperar formularios no guardados
tras cerrar el navegador. Una revocación de acceso siempre tiene prioridad sobre
los borradores locales. Los ajustes de resultado incierto conservan la clave en
sessionStorage por usuario y se recuperan consultando el movimiento o reintentando
la misma RPC; nunca se crea otro intento automáticamente.

La lista de revisión es una ayuda UX. No sustituye la autorización ni introduce
nuevas garantías de stock en el servidor; las reservas siguen siendo de etapa 5.

## Cómo revisar

`npm ci`, `npm run dev` y `http://localhost:5173/#/admin` tras la activación original.
No se necesita ejecutar SQL nuevo para este refinamiento. No probar escrituras
contra producción solo para revisar capturas: Playwright usa un dominio fixture
interceptado, sin acceso al Supabase real.

Ejecutar `npm run check`, `npm run test:e2e`, `npm run test:e2e:orders`,
`npm run test:admin:auth`, `npm run test:orders:postgres` (contenedor descartable),
`npm audit`, `npm run demo:check` e `npm run images:check`. Pruebas de navegador a
320/375/393/820/1440 px cubren carga/publicación guiada, galería, combinaciones,
stock/reservas/historial, foco/Auth, rutas, borradores y lectura de pedidos.

Los resultados realmente ejecutados y capturas se indican en la PR. SMTP,
Storage HTTP alojado y callbacks del dominio final siguen requiriendo la prueba
manual documentada; este trabajo no los modifica ni los certifica.

## Comparación visual

Capturas locales con fixtures: no contienen datos de clientes ni reflejan cambios
remotos de catálogo o inventario. Las fotos de demostración provienen de los
archivos aprobados del repositorio. El “antes” corresponde al panel de etapa 6
previo a este refinamiento. No se capturaron códigos QR ni credenciales.

| Vista           | Antes                                                          | Después                                                                                                           |
| --------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Editor, 1440 px | [Página completa](screenshots/admin-ux/before-editor-1440.png) | [Información general](screenshots/admin-ux/after-editor-1440.png)                                                 |
| Editor, 320 px  | [Página completa](screenshots/admin-ux/before-editor-320.png)  | [Información general](screenshots/admin-ux/after-editor-320.png)                                                  |
| Productos       | —                                                              | [Escritorio](screenshots/admin-ux/after-products-1440.png) · [Móvil](screenshots/admin-ux/after-products-320.png) |
| Stock           | —                                                              | [Control de stock móvil](screenshots/admin-ux/after-stock-320.png)                                                |

El historial se despliega a pedido; no alarga el formulario de stock inicialmente.
Se eligieron secciones con URL y formularios persistentes dentro del producto,
en lugar de un asistente rígido, para permitir guardar avances y retomar tareas.
