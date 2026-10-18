# Backend futuro (sin endpoints desplegados)

Reservado para Edge Functions de Supabase. `_shared/` contendrá validaciones,
clientes privilegiados, verificación de firmas y respuestas comunes. No importar
este directorio desde `src/` ni agregar claves privadas a variables `VITE_*`.

Endpoints previstos: creación de pedido/reserva como invitado, creación de
preferencia Mercado Pago, webhook, vencimiento de reservas y operaciones de
administración. No se implementan en etapa 1. No crear funciones SECURITY DEFINER
expuestas a anon para operar stock/pagos sin su validación server-side.

El backend validará datos, límites/rate limiting y autorización administrativa,
recalculará precios y descuentos en PostgreSQL y usará transacciones SQL mediante
RPC privadas ejecutables solo por service_role. Auth JWT por sí solo no acredita
ser administrador. Ver `docs/security-and-stock.md`.
