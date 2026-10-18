# Entrega de etapa 1

## Incluido

- React 19, Vite 7, TypeScript estricto y Tailwind CSS 4.
- Pantalla inicial responsive, semántica, sin compras habilitadas.
- Cliente Supabase público opcional y `.env.example` vacío, sin secretos.
- Dos migraciones: catálogo, variantes, inventario, administradores, pedidos,
  ítems, pagos, eventos idempotentes, envíos, reservas y Storage privado con RLS.
- Contrato documentado para transacciones de reservas, webhook, expiración y
  conciliación; estructura futura de Edge Functions sin lógica de pagos real.
- CI de build, lint y pruebas; lockfile para instalación reproducible.

## Comprobaciones realizadas

- `npm run lint`: sin errores ni warnings.
- `npm test`: 12 pruebas aprobadas en 3 archivos (UI, configuración, SQL/RLS).
- `npm run build`: TypeScript y build de producción correctos.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades informadas.
- `git diff --check`: sin errores de whitespace.

## Pendiente manual y límites

- Revisar el PR y las migraciones antes de fusionar; no se fusionó a main.
- Configurar un proyecto Supabase y sus valores públicos reales cuando corresponda.
- Validar stack Supabase local con CLI/Docker, Auth, PostgREST y Storage reales.
- Aprovisionar administrador de forma confiable y deshabilitar registro público.
- Autorizar explícitamente cualquier migración remota antes de ejecutarla.
- No se realizó prueba visual en navegador; la prueba UI corre en jsdom.
- No hay carrito, checkout, pagos, panel ni catálogo conectado. Las RPC privadas,
  tests de concurrencia multi-conexión y validación cross-row quedan para etapas
  futuras antes de habilitar compras. Ver `security-and-stock.md`.
- No se desplegó en Vercel ni se conectó Mercado Pago.
