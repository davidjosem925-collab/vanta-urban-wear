# Pulido de presentación previo a publicación

Rama independiente `feat/storefront-copy-polish`, basada en `3568282` de la etapa 8 porque todavía no estaba integrada en `main`. La rama y la PR #10 no se modifican. La revisión de pulido se presenta contra la rama de etapa 8 para mostrar solo estos cambios; después de integrar la etapa 8 en `main`, cambiar la base de esta revisión a `main`. No fusionar el pulido en la rama de pagos mientras se quiera conservar intacta la PR #10.

## Texto y decisiones

| Superficie      | Resultado                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Franja superior | `PROYECTO FICTICIO / PORTFOLIO — NO SE REALIZAN COMPRAS REALES`; sin «COMPRAS PRÓXIMAMENTE», texto legible y con salto de línea en móvil                                                          |
| Nombres         | Se oculta únicamente el sufijo final `— DEMO` y sus equivalentes con guion; mismo nombre en tarjetas, ficha, breadcrumbs, notificación, controles accesibles, carrito y resumen                   |
| Descripciones   | Se conserva la descripción comercial original de cada prenda; se retiran solo las dos aclaraciones conocidas del catálogo y las notas de fotografía principal de los cuatro productos adicionales |
| Fotografías     | Se mantiene la descripción accesible de la prenda y su color; sin repetir los avisos de generación en cada imagen. No se cambian fotos, rutas, firmas, caché ni licencias                         |
| Disponibilidad  | Sin «Variantes publicadas · Stock por confirmar», punto de disponibilidad o descuento no publicado. No se muestra stock numérico ni se afirma que haya existencias                                |
| Carrito         | «Continuar al checkout», límite breve por combinación y aviso único de que agregar no reserva unidades. Precios, cantidades y controles conservados                                               |
| Checkout        | «Finalizar compra», «Revisar pedido», «Confirmación», «Método de pago», «Mercado Pago», «Retiro en local · Sin costo»                                                                             |
| Privacidad      | Se mantiene la indicación de usar datos de ejemplo y correo autorizado cuando corresponda; nombre/teléfono/domicilio no se envían. No se cambia retención ni envío                                |
| Pie             | Sin dirección inventada ni correo que pueda parecer un contacto comercial; indica que no hay local ni atención al público                                                                         |

La consulta anónima de **solo lectura** a los productos publicados confirmó 12 nombres con sufijo y dos variantes de la misma aclaración. No se modificaron esas filas, semillas ni históricos: `presentation.ts` contiene funciones puras que limpian únicamente el texto que se presenta en la tienda. Precios, slugs —incluido `vanta-demo-…`—, IDs, variantes, cantidades, payloads, nombres de snapshots de pedidos y relaciones quedan intactos. Las descripciones desconocidas no se reescriben indiscriminadamente.

El administrador y los registros/correos históricos siguen mostrando sus datos originales. No hace falta cargar SQL para aplicar el pulido. Si se desea renombrar también el catálogo fuente administrativo, debe ser una revisión separada de datos; no es parte de este trabajo.

## Avisos que se conservan intencionalmente

Antes de crear la operación MP desde la revisión y antes de iniciar/reanudar su checkout alojado se muestra, en flujo normal y sin modal:

**Compra de demostración**

> VANTA es un proyecto ficticio de portfolio. Estás por ingresar al entorno de pruebas de Mercado Pago. No se realizará ningún cobro real. Utilizá únicamente cuentas y tarjetas de prueba.

El aviso no introduce confirmaciones extra, llamadas de red ni cambios de foco. No activa Mercado Pago si el flag está apagado. Las pruebas de pago usan servicios interceptados, no credenciales reales.

Se conservan las aclaraciones en pantallas de finalización/estado, instrucciones de transferencia sin cuenta real, medidas orientativas no oficiales y las advertencias demo/no fiscal de los correos. No se modificaron las plantillas Resend ni las solicitudes de envío congeladas. Los términos técnicos en rutas, tipos, payloads, flags, pruebas, diagnósticos y administración privada son deliberados; no se realizó un reemplazo global de identificadores.

## Verificación

- Pruebas de presentación sobre los 12 productos de ambas semillas, idempotencia de la limpieza y conservación de datos/textos desconocidos.
- Pruebas de selección, carrito y checkout mantienen los mismos importes, validaciones, cambios de talle/color, persistencia y comportamiento responsive; se actualizan sus nombres accesibles esperados.
- Nuevo recorrido de catálogo a checkout con nombres originales que incluyen `— DEMO`, manteniendo el slug técnico sin cambios.
- Pruebas MP verifican que el aviso esté visible **antes del botón de pago**, con su texto exacto, y que el botón conserve las validaciones anteriores.
- Anchos 1440, 820, 375, 393 y 320 px; revisar franja, espacios del resumen, nombres, aviso y ausencia de desbordes.
- Durante la revisión se eliminó una nota de retiro repetida en el resumen, conservando esa información una sola vez.

Resultados finales de `npm run check` y suites Playwright en la PR independiente. Los flags usados por Playwright son fixtures de su servidor aislado, no activaciones de las variables de la tienda.

## Revisión visual del propietario

```bash
npm ci
npm run dev
```

Revisar Inicio, Colección, una ficha, carrito y checkout con la configuración pública habitual. El formulario sigue indicando que se usen datos de ejemplo. No habilitar pagos/correos para esta revisión.

Para comprobar el recorrido con la advertencia MP sin servicios reales:

```bash
npm run test:e2e:payments
```

El test utiliza proveedores simulados. No prueba una compra real sandbox ni entrega de correo. Esta tarea no publica en Vercel, cambia secretos, modifica servicios o aplica migraciones. La activación de etapa 8 continúa siendo una decisión independiente con su propia guía.

## Ajuste final de confirmación (PR #11)

El método de pago muestra «Seleccioná cómo querés pagar.». Con una respuesta de pedido del servidor, la finalización muestra «Pedido registrado.» y «Tu pedido fue registrado correctamente.», manteniendo referencia, subtotal, vencimiento y navegación. Se retira el subtítulo previo a confirmar y se concentra el aviso en «Pedido de prueba»: «Esta operación pertenece a una tienda ficticia. No constituye una compra real ni un comprobante de pago.».

Con la creación de pedidos deshabilitada no se afirma que un pedido haya sido registrado: se muestra «Selección confirmada.» / «Tu selección está lista.» y se aclara que sigue en el carrito. Las etiquetas de pago son «Pago pendiente.», «Pago aprobado.», «Pago rechazado.» y «Pago cancelado.», sin cambiar sus condiciones. La aprobación sigue requiriendo estado aprobado, conciliación resuelta y pedido confirmado/preparando/entregado, verificados por el servidor. No se activan flags ni servicios.
