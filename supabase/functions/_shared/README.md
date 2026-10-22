# Módulos compartidos exclusivos del servidor

`mp-orders/` implementa el backend de Mercado Pago Orders API de prueba (fase 2).
Se importa únicamente desde las Edge Functions, nunca desde `src/`.
No contiene credenciales: se leen desde los secretos del runtime.

Ver `docs/stage-8-payments-backend.md` para contratos, límites, activación manual y reversión.
