# Etapa 8 — diagnóstico y diseño propuesto

Estado: **fase 1, solo documentación**. Base `main` en
`f7aac036cb74f8f9541c5ba9c4bb534358aecb50` (PR #9 fusionada).
Rama `feat/stage-8-payments-email`. No se implementan pagos, envíos de correo,
migraciones ni cambios de configuración en esta entrega inicial.

## 1. Diagnóstico del código

| Área | Situación comprobada en el repositorio | Consecuencia para etapa 8 |
| --- | --- | --- |
| Checkout | React/Vite, formulario en memoria, catálogo y carrito revalidados; `App` acepta un `OrderService` inyectable | Reutilizar componentes y pruebas; agregar el nuevo contrato como versión explícita, preservando el flujo anterior |
| Pedidos | `demo-orders` verifica Turnstile, origen, capacidad e idempotencia; `demo_create_order` valida precio y disponibilidad en PostgreSQL | No crear pedidos desde React ni aceptar total/estado como autoridad del navegador |
| Contacto | El backend rechaza campos extra y guarda `Visitante Demo`, no el email escrito en el formulario | Para enviar correos reales es imprescindible introducir contacto mínimo protegido; no basta conectar un proveedor |
| Stock | Reserva de 60 minutos, bloqueos ordenados, vencimiento evaluado después de adquirir locks y movimientos terminales únicos | Conciliar pago y stock mediante transacciones; nunca extender o recrear reservas desde un webhook |
| Pagos | Ya existen `payments` y `payment_events`, RLS y un índice de un pago aprobado por pedido; no hay integración externa | Ampliarlas incrementalmente; no crear otro sistema paralelo ni dar DML amplio al backend |
| Estados | Pedidos demo usan `pending/confirmed/preparing/delivered/cancelled/expired`; su CHECK no permite `paid` | Estado del pago separado del estado logístico; no copiar estados del proveedor directamente a `orders.status` |
| Administración | `demo_admin_transition` permite confirmar cualquier pedido demo pendiente | Para pedidos nuevos con Mercado Pago, bloquear confirmación manual que eluda evidencia de pago; conservar la gestión de pedidos anteriores |
| Auth | Magic Link/contraseña bajo modo por correo; `is_admin()` comprueba perfil activo y, en la migración de correo, usuario/sesión vigentes | No rediseñar Auth ni reducir autorización. Cada RPC nueva debe comprobar `is_admin()` cuando sea administrativa |
| Retención | `demo_cleanup()` excluye pedidos con pagos y conserva tombstones; la política actual no contempla email real | Definir purga de contacto y cola; no borrar pagos/eventos ni modificar pedidos anteriores |
| Hosting | SPA por hash; CSP restrictiva; `demo-orders` exige Origin y no sirve como webhook de proveedor | Separar endpoint de compra, webhook firmado y worker privado; retorno del proveedor no autoriza ni confirma |

La documentación antigua describe despliegues como pendientes: no demuestra el
estado remoto actual. En esta fase **no se consultó Supabase alojado**. La revisión
remota de solo lectura, si hiciera falta antes de activar, será un paso manual.

El entorno de Codex observado solo dispone de las dos variables públicas de
Supabase. No hay credenciales configuradas de Mercado Pago ni correo. La política
de red tampoco permite actualmente `api.mercadopago.com` o `api.resend.com` desde
el ejecutor. Esto no impide programar y probar con servicios simulados; sí impide
afirmar una integración externa probada desde este entorno. No se solicitaron ni
imprimieron secretos.

## 2. Decisiones de integración

### Mercado Pago: Checkout Pro alojado, exclusivamente de prueba

La documentación oficial actual publica dos variantes: Preferences API y Orders
API. **Se propone Orders API** para esta implementación nueva: creación backend
`POST /v1/orders`, `X-Idempotency-Key`, consulta `GET /v1/orders/{id}` y redirección
al `checkout_url` devuelto. Ofrece importes decimales como texto y una identidad
para el ciclo de pago. No mezclarla con `/checkout/preferences` ni con los estados
de Payments API. No se agregan formularios de tarjeta ni SDK de captura a VANTA.

La disponibilidad efectiva para la aplicación argentina del propietario requiere
una prueba controlada con su cuenta de prueba; leer documentación no la verifica.
Si esa variante no está habilitada, se revisará expresamente un adaptador
Preferences API también oficial, sin cambiar silenciosamente de protocolo.

Reglas propuestas:

- Integración apagada por defecto y backend que solo acepte modo de pruebas. No
  implementar una vía productiva. Credenciales de prueba oficiales, aplicación y
  vendedor de prueba identificados explícitamente; no deducir seguridad únicamente
  del prefijo del token, del nombre de una variable o del dominio del checkout.
- Verificar el contrato oficial que permite identificar el entorno de prueba en
  credenciales/recursos de la aplicación antes de habilitar creación. Rechazar
  recursos productivos o de entorno no comprobable; no ensayar esta protección
  mediante un cobro real. Si falta esa evidencia, mantener creación deshabilitada.
- Separar la identidad de comprador de prueba de Mercado Pago del destinatario
  real autorizado para los correos de VANTA.
- Montos internos en centavos enteros. Convertir al texto decimal requerido por
  el proveedor mediante cociente/resto, sin aritmética flotante. Total calculado
  desde snapshots del pedido, moneda ARS y país Argentina.
- No prometer todos los medios productivos: ofrecer los habilitados por el
  checkout de prueba y documentar diferencias de la cuenta/país.
- Validar host HTTPS del `checkout_url` para Argentina. Retornos y URLs externas
  fijados en backend; no aceptar `next`, importe o URL arbitrarios del cliente.
- Mantener Turnstile, límites existentes, capacidad de recuperación y precios
  revalidados. Ni un retorno `success` ni un botón del navegador aprueban pagos.

### Recursos y autorización

Reutilizar `orders/order_items/inventory/stock_reservations/payments/payment_events`.
Preparar migraciones nuevas, sin actualizar filas históricas ni reescribir las
migraciones previas. Diferenciar pedidos de integración mediante versión/modo
explícitos. Completar identificadores externos de order/transacción, estado bruto
acotado, entorno, referencia, importe verificado y estado de conciliación. La CHECK actual de
`payments.status` tampoco admite `expired`: cualquier nuevo estado deberá
incorporarse explícitamente en la migración y en sus pruebas, sin desactivar
la restricción ni confundirla con la del pedido.

Agregar una tabla de contacto mínimo y una outbox de correos. Sus RLS y permisos
se definirán específicamente, sin acceso anónimo ni escritura directa del admin.
Exponer RPC estrechas `SECURITY DEFINER`, con `search_path` vacío y `EXECUTE`
revocado a PUBLIC y roles que no las necesiten. Revisar y revocar el DML amplio
heredado de `service_role` sobre pagos/eventos/contacto/cola: BYPASSRLS no sustituye
privilegios SQL. Todas las escrituras deberán pasar por las operaciones previstas.

Los nombres y SQL definitivos se entregarán en fase 2. Las nuevas restricciones
se validarán sobre filas anteriores antes de aprobar una migración; nada de
`UPDATE` masivo, borrado, ampliación indiscriminada de RLS o conversión histórica.

### Creación, webhook y conciliación

1. El endpoint de compra valida la petición y el challenge. Una RPC crea/reutiliza
   pedido, reserva y tentativa de pago con identidad idempotente en una transacción.
2. HTTP a Mercado Pago ocurre **fuera** de la transacción y de los locks de stock.
   Timeout o respuesta perdida no crean otra reserva: se conserva identidad y
   cuerpo y se recupera/reintenta el mismo recurso dentro del contrato del proveedor.
3. Webhook separado, sin requisito Origin/JWT de cliente: autenticidad mediante
   firma oficial HMAC, parámetros/cabeceras canónicos y comparación segura. Límites
   de tamaño, solicitudes y tipos admitidos. No registrar cuerpos, firmas,
   capacidades, tokens, claves de idempotencia ni contacto.
4. Acusar recepción únicamente después de persistir durablemente el evento
   autenticado mínimo. Si la persistencia falla, devolver un error reintentable.
   Webhook duplicado no significa repetir una operación ya completada.
5. Worker privado obtiene el recurso desde la API oficial usando su ID validado,
   nunca una URL tomada del cuerpo. Comprueba vendedor/aplicación, entorno,
   referencia, moneda y total completo antes de conciliar. Firma válida por sí
   sola no demuestra un pago aprobado; no confiar en `live_mode` sin contrastar
   también recurso, credenciales y vinculación local.
6. Una RPC bloquea el pedido y el stock en el orden existente, verifica reserva
   activa y plazo de servidor, aplica una única transición y encola el correo en
   la misma transacción. No consumir stock desde JavaScript.
7. Worker también reconcilia operaciones pendientes/inciertas, con reintentos
   acotados y backoff; evita depender exclusivamente de entrega de webhooks.

Guardar eventos acotados y versiones/fechas del proveedor permite detectar
notificaciones fuera de orden. Un evento viejo no debe deshacer una aprobación.
Dos workers deben poder reanudar el trabajo mediante leases y `SKIP LOCKED`.
Una segunda aprobación externa debe registrarse para revisión, no ocultarse por
un conflicto del índice único ni consumir stock una segunda vez.

### Reservas y estados

La reserva continúa siendo **exactamente 60 minutos desde creación del pedido**.
Configurar vigencia del checkout hasta el plazo restante cuando lo admita la API;
verificar su mínimo/granularidad en la referencia y la cuenta. Expiración del
proveedor no reemplaza el control PostgreSQL ni garantiza que nunca llegue una
notificación tardía. Medios diferidos pueden superar ese plazo.

| Resultado verificado | Pago local | Pedido/stock |
| --- | --- | --- |
| Creado o procesándose | Pendiente | `pending`, reserva activa hasta su plazo |
| Acreditado y reserva todavía válida | Aprobado de prueba | `confirmed`, consumir una sola vez mediante la primitiva existente |
| Rechazado | Rechazado | Mantener opción de reintento dentro del plazo; no cancelar todo el pedido por un intento fallido |
| Cancelación final | Cancelado | Cancelar y liberar una sola vez; confirmar primero el resultado del proveedor si hay carrera |
| Vencimiento | Vencido | `expired`, liberar una sola vez por el mecanismo existente |
| Acreditado después del plazo/cancelación | Acreditado de prueba, requiere revisión | No reabrir el pedido ni consumir stock liberado; no enviar la confirmación normal de compra |

El mapeo de Orders API se basará en `status` y `status_detail` oficiales: por
ejemplo, `processed/accredited` no es lo mismo que `action_required/waiting_capture`
ni que un reembolso parcial. No interpretar cualquier `processed` como pago pleno.
Reembolsos/contracargos observados se conservarán para revisión; no reponer stock
automáticamente por su sola llegada. No se implementa un sistema comercial de
reembolsos en esta fase.

### Transferencia demo

Crear pedido pendiente con reserva habitual. Instrucciones sin cuenta, alias
operativo, CBU válido ni QR pagable: texto inequívoco «No transfieras dinero real».
Sin botón público «Ya pagué» que apruebe, sin subida de comprobantes personales.
Una RPC administrativa específica, con perfil/sesión vigentes, razón, actor e
idempotencia, podrá registrar **confirmación simulada**, diferenciada de Mercado
Pago. Confirmar después del vencimiento debe fallar sin tocar stock.

El cierre automático de pedidos antiguos y los métodos legacy, incluido efectivo
demo, mantendrán compatibilidad. La nueva vía no podrá utilizar la confirmación
administrativa legacy para aprobar Mercado Pago sin evidencia del servidor.

### Correo: Resend por API desde backend

Proveedor propuesto: **Resend**, por API HTTPS, plantillas HTML/texto e idempotencia.
No reutilizar ni alterar SMTP, plantillas o redirecciones de Supabase Auth.

En la demo, solo enviar a una lista de direcciones de prueba cuya titularidad
haya comprobado el propietario, validada en backend y guardada como configuración
privada, no en el repositorio. Con `resend.dev`, el proveedor permite únicamente
el correo de la propia cuenta; para otros destinatarios hace falta un dominio
propio verificado y registros DNS del proveedor. No usar direcciones simuladas de
entrega/bounce como prueba de recepción real.

- Persistir únicamente el email real necesario en contacto protegido. Otros
  datos del formulario pueden continuar en memoria: no hace falta guardar
  domicilios, teléfonos o documentos para esta demo.
- Vincular email inmutable a la creación idempotente del pedido (hash de contacto
  en el contrato nuevo). Reintentar no permite cambiar destinatario. Recuperación
  con capacidad no exige reingresar ni devuelve el email. No persistir contacto
  en el carrito, URL, logs o almacenamiento de intentos.
- Aviso de privacidad actualizado: el texto actual de datos no persistidos debe
  cambiar antes de solicitar email real. Retención propuesta de contacto/cola:
  30 días, documentando excepciones mínimas de conciliación y purga; no equiparar
  borrado local con borrado de los registros del proveedor.
- Outbox transaccional con clave única por pedido/tipo/versión del evento; lease,
  estado `queued/sending/sent/failed/unknown`, intentos y ID del proveedor.
- Enviar `order_received` con pago pendiente; enviar un aviso de pendiente solo
  si hay una evolución relevante; enviar confirmado exclusivamente tras pago
  conciliado y pedido confirmado. Transferencia lleva «confirmación simulada».
- Plantillas con referencia, snapshots de artículos/variantes/cantidades/precios,
  total ARS y estado. Sin datos de tarjeta ni URLs que contengan capacidades.
- Resend conserva idempotencia **24 horas**. Ante resultado incierto, reintentar
  con la misma clave/cuerpo dentro de esa ventana; después, reconciliar o dejar
  para revisión, sin reenvío ciego. No prometer entrega exactamente una vez ante
  cualquier partición de red o fallo del proveedor.
- No enviar desde el navegador ni ante cada polling/render del estado. Un fallo
  de correo no debe revertir un pago/pedido confirmado. Rebotes y rechazos quedan
  visibles; recepción real debe comprobarse en una casilla autorizada.

## 3. Cinco fases y criterios de aceptación

| Fase | Entrega | Criterio de aceptación |
| --- | --- | --- |
| 1. Auditoría/diseño | Este documento, rama independiente y PR en borrador | Arquitectura, riesgos, dependencias y pasos manuales explícitos; sin activación ni código de pago |
| 2. Backend | Migración incremental revisable, adaptador MP, creación/recuperación, webhook/conciliador y RPC | Precio/moneda/referencia/vendedor comprobados; modo productivo bloqueado; reintentos y concurrencia no duplican reserva, pago aplicado ni consumo; SQL local y tests negativos pasan |
| 3. Checkout | Redirección oficial, retorno seguro, transferencia ficticia, mensajes de estado | Ningún parámetro del retorno aprueba; persistencia/recuperación segura; rechazo o red incierta no fingen éxito; responsive 320/375/393/820/1440, teclado/foco y sin desbordes |
| 4. Correo | Contacto mínimo, outbox, worker, plantillas y retención | Destinatarios permitidos; información tomada de snapshots; duplicados no reenvían; límites de idempotencia gestionados; recepción auténtica verificada manualmente tras aprobar configuración |
| 5. Admin/cierre | Estados de pago y logística separados, auditoría y guía de despliegue/reversión | Auth/Magic Link/contraseña/RLS conservados; transferencias solo por RPC autorizada; ningún botón confirma MP; suite completa y pruebas reales de sandbox documentadas por separado |

Pruebas futuras: firma inválida, webhook repetido/fuera de orden, total/moneda/
vendedor incorrectos, recursos live, aprobación parcial, red perdida al crear,
doble clic, procesos simultáneos, rechazo/reintento, cancelación vs aprobación,
aprobación vs expiración antes/después de locks, cron repetido, recuperación sin
sesión y correo fallido/duplicado/incierto. PostgreSQL descartable para carreras y
viaje temporal; navegador con APIs simuladas; Auth nativo aislado; sandbox real y
recepción de correo claramente separados. Ejecutar lint, TypeScript frontend/Edge,
Vitest, build, audit, suites E2E y pruebas SQL/Auth pertinentes.

## 4. Servicios y trabajo manual del propietario

**Ahora no es necesario proporcionar secretos ni hacer cambios remotos.** Para
la activación posterior, en este orden:

1. Elegir la aplicación de Mercado Pago Argentina y obtener las credenciales
   oficiales de prueba, vendedor/comprador y tarjetas de prueba. Confirmar acceso
   a Orders API y los indicadores verificables de entorno. No activar cobros
   productivos ni usar cuenta/tarjetas reales para las compras de prueba.
2. Elegir un origen HTTPS estable de pruebas. Para probar webhooks hace falta un
   endpoint HTTPS alcanzable; localhost solo no recibe tráfico de Mercado Pago.
   Puede ser una vista previa no promocionada públicamente; no se inventa dominio
   definitivo ni se despliega/tuneliza sin aprobación. Revisar retornos de checkout,
   origen permitido y Turnstile; conservar las rutas/redirecciones de Auth actuales.
3. Crear Resend y elegir un destinatario propio para comenzar sin dominio; para
   otras casillas, verificar dominio/subdominio propio con SPF/DKIM y política
   DMARC adecuada. Comprobar límites/costos vigentes y remitente. No cambiar el
   servicio de correo de Magic Link por esta integración.
4. Revisar la migración propuesta, su preflight/rollback y copia de seguridad.
   Confirmar esquema/grants/cron mediante consultas de solo lectura. Aplicar
   **solo** la nueva migración aprobada, nunca reaplicar las de etapas anteriores.
5. Cargar secretos backend en Supabase por su interfaz segura: credencial de
   prueba MP, secreto de firma webhook, identificadores permitidos de vendedor/
   aplicación, API key Resend, remitente, destinatarios permitidos y secreto del
   worker. Nombres finales se fijarán con el código. Nada privado con prefijo
   `VITE_`, nada en Git o en el chat. Configurar dominios salientes del entorno de
   desarrollo solo si se aprueban pruebas externas desde Codex.
6. Aprobar y desplegar explícitamente las funciones nuevas. Configurar webhook
   de la aplicación para pruebas y validar su firma. La guía actual de Orders API
   menciona «Modo productivo» en la pantalla de notificaciones: **no interpretarlo
   como permiso para usar credenciales/cobros productivos**. Comprobar en el panel
   la ruta de pruebas disponible y, si es ambigua, mantener la función apagada
   hasta validarla con el proveedor. Simular una notificación no prueba un pago.
7. Programar worker privado de conciliación/correos. Propuesta: Supabase Cron +
   `pg_net`, secretos en Vault siguiendo documentación oficial. Comprobar primero
   si las extensiones están disponibles; instalar/configurar únicamente con
   aprobación. No tocar ni sustituir `vanta-demo-expiry`. No guardar secretos en
   SQL versionado ni habilitar un endpoint público para disparar envíos.
8. Habilitar inicialmente un solo destinatario y ejecutar una compra sandbox
   controlada: importe exacto, pago acreditado consultado en backend, un único
   consumo de stock, evento y correo recibido. Luego probar rechazo, transferencia,
   repetición del webhook y vencimiento, sin manipular pedidos anteriores.
9. Activar flags solo tras superar esos controles. La PR sigue en borrador hasta
   completar criterios; no fusionar ni publicar automáticamente.

Rollback propuesto: bloquear nuevas creaciones de etapa 8 en servidor/interfaz,
pero mantener conciliación de intentos ya abiertos hasta resolverlos; pausar
correos nuevos sin descartar la outbox; conservar cron de expiración y ledger.
No hacer DROP de tablas ni borrar pagos al revertir código. La reversión SQL
requiere verificar antes que no queden reservas, intentos o correos pendientes.

## 5. Evidencia y límites de esta fase

Auditoría estática del código y migraciones, lectura de documentación oficial y
comprobación local de baseline. No se enviaron peticiones a Mercado Pago/Resend,
correos, webhooks, SQL remoto ni despliegues. Los resultados de pruebas se
registran en la descripción de la PR. La habilitación específica de Orders API,
la configuración efectiva de Auth/cron remoto y la entrega real de correo siguen
pendientes de las operaciones manuales anteriores.

Fuentes oficiales consultadas:

- [Checkout Pro vía Orders API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/overview)
- [Crear order: endpoint, idempotencia y montos](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order)
- [Referencia API](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/create-order/post)
- [Compras con cuenta de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/integration-test-introduction)
- [Webhooks y firma](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications)
- [Estados de Orders API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/payment-management/status/order-status)
- [Checkout Pro vía Preferences API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/overview)
- [Resend: destinatarios del remitente de prueba](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend: dominios verificados](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: idempotencia y ventana de 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Supabase: programación de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
