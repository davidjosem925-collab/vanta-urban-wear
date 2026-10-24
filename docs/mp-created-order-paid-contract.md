# Total pagado ausente: decisión de compatibilidad por estado

> Registro histórico. El contrato funcional posterior y su activación manual están en [Evidencia de órdenes v2](mp-order-evidence-v2.md). Esa revisión separa importe desconocido de acreditación; no normaliza ausencia a cero.

## Resultado

La evidencia de `mp-reconcile` versión 9 (`get`, `paid_amount`, `missing`) confirma que el recurso consultado no aporta `total_paid_amount`. No prueba el `status`/`status_detail` del proveedor ni que el importe pagado sea cero. El `pending` del pedido/pago local no sustituye el estado remoto.

**No se modifica el parser ni se añade un fallback por estado.** No se encontró en las fuentes oficiales consultadas una regla que garantice cómo interpretar esa omisión para Checkout Pro. Se aplica la alternativa conservadora solicitada: documentar el impedimento y agregar regresiones. Esta PR no desbloquea el pago alojado ni requiere desplegar funciones.

## Fuentes revisadas (23/10/2026)

| Fuente oficial | Qué establece | Qué no demuestra |
| --- | --- | --- |
| [Guía de creación](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order) | Define el total pagado como texto y muestra una respuesta inicial con importe explícito. | No define una excepción de campo ausente para órdenes creadas o pendientes. |
| [Referencia GET de Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/get-order/get) | Consulta por ID y muestra el total pagado como texto decimal. | No documenta una equivalencia entre ausencia y cero ni reglas condicionales de omisión. Un ejemplo no constituye un esquema completo de obligatoriedad. |
| [Estados de Orders API](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-orders/payment-management/status/order-status?scope=prod) | Distingue creación, procesamiento, acreditación, autorización y devolución. | No define la representación del importe ausente para cada estado. |
| [Notificaciones de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications) | Ejemplifica acreditación con total pagado y transacciones explícitos. | No autoriza reconstruir un importe faltante a partir del estado o el total solicitado. |
| [SDK Go oficial, v1.14.0](https://github.com/mercadopago/sdk-go/blob/v1.14.0/pkg/order/response.go) | Modela `TotalPaidAmount` como string con etiqueta `omitempty`. | Esa etiqueta controla la serialización del SDK; no es una garantía de que el servidor omita el campo en un estado concreto ni de que vacío signifique cero. También se utiliza para campos de identidad. |

La tabla de estados describe `created/created` como etapa anterior al procesamiento y `processed/accredited` como acreditación. El estado de procesamiento utiliza `processing` con detalles como `in_process` o `pending_review_manual`; no enumera un `pending` superior equivalente al `pending` interno de VANTA. No se introduce ese alias.

La referencia GET incluye un ejemplo genérico con estado de creación y total pagado no nulo; la guía de creación muestra cero explícito. Esos ejemplos ilustrativos no permiten establecer una regla universal sobre presencia o ausencia. No se interpreta esa diferencia como prueba de que el proveedor tenga un pago concreto.

## Por qué no se adapta todavía

Es posible reconocer conceptualmente una orden no acreditada sin afirmar que haya un pago. Eso no proporciona el importe que exige el contrato financiero actual de VANTA: `Snapshot.paid_cents` es numérico y la RPC valida esa evidencia. Reemplazar ausencia por cero introduciría un dato que el recurso no aporta. Usar `total_amount`, sumar transacciones sin un contrato confirmado o considerar todo `pending` local como `created` remoto tampoco es justificable.

No se cambia `cents()`, `snapshot()`, SQL, enlaces de órdenes, reintentos, idempotencia, cron, reservas, inventario ni mensajes de aprobación. Permanecen los controles de vendedor, aplicación, moneda, país, referencia, ID, total, productos, fecha y URL. Acreditación sigue requiriendo total pagado explícito, parseable y exacto; un texto parcial no aprueba, un exceso se rechaza y una etiqueta acreditada con campo ausente se rechaza.

Esto no significa que el proveedor garantice que el campo esté siempre presente: significa que la omisión observada carece todavía de una interpretación financiera confirmada para nuestra integración.

## Evidencia mínima adicional, sin otra compra

Para el recurso ya existente, obtener privadamente mediante las herramientas del vendedor o el GET oficial de solo lectura, sin crear transacciones:

1. `status` y `status_detail` **remotos**, con valores normalizados; no el estado local de VANTA.
2. Solo la forma de `transactions.payments`: ausente, vacío o presente. Si está presente, sus estados/detalles, sin IDs, tokens, contactos ni cuerpos completos. No hace falta compartir importes para esta primera confirmación del contrato.
3. Confirmación escrita de soporte o especificación oficial de MP que indique si la ausencia de `total_paid_amount` es intencional para ese par de estados en Checkout Pro `online/manual` sandbox Argentina, qué significa y cuándo pasa a ser explícito.
4. La regla oficial para detectar transacciones autorizadas/acreditadas o estados contradictorios cuando el total está ausente, y cómo verificar el importe antes de cualquier liquidación local.

Consulta sugerida al proveedor: «En GET /v1/orders de Checkout Pro online/manual sandbox Argentina, el recurso existente omite total_paid_amount. ¿Qué estados y condiciones permiten esa omisión? ¿Representa un importe desconocido o existe una garantía documentada de cero? ¿Qué evidencia debe exigirse antes de tratar un pago como acreditado?». Agregar el ID únicamente en el canal privado oficial del proveedor si lo solicita; no publicarlo en GitHub.

Con esa confirmación se podrá definir un tratamiento acotado para los estados permitidos, considerando explícitamente el importe desconocido si corresponde, sin reutilizarlo como evidencia de acreditación. Hasta entonces no resetear intentos, extender reservas, enlazar por SQL ni iniciar otra compra para resolver el contrato. No se ejecutó ninguna consulta real en este trabajo.

## Regresiones

- Campo realmente omitido en creación, procesamiento, revisión manual, autorización, acreditación, devolución parcial y devolución total; no se convierte a cero. Incluye `pending` literal para impedir inferir que sea un alias remoto permitido.
- Etiqueta de acreditación con `null`, número, texto inválido o exceso: rechazo financiero.
- Acreditación con texto decimal explícito pero insuficiente: revisión; con total exacto: aprobación según la lógica existente.
- Integración en SQL aislado con GET sin importe en creación, procesamiento o acreditación: pending/unlinked, una reserva, cero consumos de inventario y sin otro POST simulado.

Las fixtures de MP y PGlite son locales, no prueban el sandbox alojado. `npm run check` aprobado: **759 pruebas / 52 archivos**, lint, TypeScript de Edge/frontend y build. La suite focalizada aprobó **162 pruebas**, incluidas en las 759. Se agregaron 18 casos. La PR nueva está basada en la PR #13. No hay código productivo, migraciones, configuración o secretos que activar; desplegar esta PR no corregiría la omisión del proveedor.
