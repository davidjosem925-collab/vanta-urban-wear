# Backend de demostración — etapa 5

`demo-orders/` contiene un endpoint de invitado con challenge obligatorio,
validación acotada, límites SQL persistentes y capacidad de recuperación/cancelación.
No hay endpoint público para leer pedidos. Las RPC de creación/reserva se ejecutan
en una transacción y no son accesibles con la clave pública del navegador.

Nunca importar estas carpetas desde `src/` ni usar secretos en variables `VITE_*`.
El servidor utiliza los bindings Supabase de Edge; no crear claves aquí.

Despliegue, permisos, Turnstile, job pg_cron, retención, pruebas y aprobaciones:
[docs/stage-5-orders-stock.md](../../docs/stage-5-orders-stock.md).
No se desplegó esta función ni se ejecutaron operaciones remotas durante el desarrollo.

## Etapa 8, fase 2 — Mercado Pago de prueba

`mp-checkout/`, `mp-webhook/`, `mp-reconcile/` y `_shared/mp-orders/` agregan el
backend sandbox, apagado por defecto. No reemplazan ni despliegan `demo-orders`.
No incluyen interfaz ni envío de correos. El webhook verifica firma y consulta
Orders API; la conciliación de stock ocurre en RPC service-only.
[Contratos, secretos, migración y reversión](../../docs/stage-8-payments-backend.md).
