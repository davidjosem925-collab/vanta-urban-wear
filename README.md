# vanta-urban-wear
E-commerce de indumentaria urbana con React, Supabase y Mercado Pago

## VANTA — Etapa 1

Tienda ficticia para portfolio con identidad **Dark Luxury**: negro, grafito y
blanco. Base en React + Vite + TypeScript + Tailwind CSS 4, PostgreSQL/Supabase,
Auth para administradores y Storage privado. Mercado Pago Checkout Pro y Vercel
se integrarán más adelante.

### Instalación

Requisitos: Node.js 22.12+ (CI usa 24), npm y Git.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

La pantalla inicial funciona sin configurar Supabase. Para conectar un proyecto,
completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con su URL y clave
publicable (o anon legacy). Ambas son públicas; RLS protege los datos. Nunca usar
`service_role`, `sb_secret_*`, contraseñas ni tokens de Mercado Pago en `VITE_*`.
El validador rechaza claves privilegiadas conocidas, pero no reemplaza la revisión
de secretos. No versionar `.env.local`.

### Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Desarrollo local |
| `npm run build` | TypeScript estricto + bundle en `dist/` |
| `npm run preview` | Servir el build local |
| `npm run lint` | ESLint, sin warnings |
| `npm test` | Pruebas de UI, configuración y SQL/RLS embebido |
| `npm run test:watch` | Pruebas en modo desarrollo |
| `npm run test:e2e` | Carrito en Chromium: escritorio y dos tamaños móviles, sin tráfico remoto |
| `npm run check` | Lint + pruebas + build |
| `npm run verify:supabase` | Verificar lectura real con variables privadas configuradas |

### Estructura

- `src/app/`: pantalla inicial, estilos y prueba de presentación.
- `src/lib/supabase/`: cliente público nullable y validación de configuración.
- `src/test/`: configuración de pruebas.
- `supabase/migrations/`: esquema, permisos, RLS y bucket privado de imágenes.
- `supabase/tests/`: ejecución SQL en PostgreSQL embebido (PGlite).
- `supabase/functions/`: estructura y contratos para backend futuro, sin endpoints.
- `docs/security-and-stock.md`: acceso, reservas atómicas y pagos concurrentes.
- `.github/workflows/ci.yml`: validación automática de pushes y pull requests.

### Supabase: preparación manual

No se ejecutaron migraciones remotas. Antes de cualquier aplicación remota se
requiere autorización explícita y revisión de SQL, proyecto destino y respaldo.

1. Instalar Supabase CLI y Docker si se desea validar el stack local completo.
2. Ejecutar `supabase init` (revisar el archivo generado) y `supabase start`.
3. Solo en el entorno local descartable, ejecutar `supabase db reset` para aplicar
   las migraciones. **Este comando reinicia la base local**; no usar `--linked`.
4. Validar permisos con clientes anon, usuario autenticado común y administrador.
   Ver limitaciones de las pruebas en `docs/security-and-stock.md`.
5. Crear el usuario administrador en Supabase Auth por un canal confiable;
   deshabilitar registro público de usuarios para este proyecto y aprovisionar
   `admin_profiles` mediante SQL confiable con su UUID real. No hay autoasignación
   desde metadata, registro ni interfaz pública. No inventar UUID/credenciales.
6. Para conexión real, cargar únicamente URL y clave pública en `.env.local`.

El bucket `product-images` es privado, acepta JPEG/PNG/WebP/AVIF hasta 5 MiB.
Solo administradores cargan archivos; visitantes acceden a imágenes asociadas al
catálogo visible mediante descarga autenticada con clave pública o URLs firmadas
de corta duración. No usar `getPublicUrl` para este bucket. Si se oculta un producto,
una URL firmada ya emitida puede seguir vigente hasta su vencimiento.

### Alcance y próximos pasos

La etapa 1 entrega una pantalla inicial ilustrativa, infraestructura local y
migraciones revisables. No incluye catálogo conectado, buscador, carrito, checkout,
pagos reales, endpoints de compra ni panel. No hay datos personales de prueba
reales ni credenciales. Las ilustraciones se generan con CSS, sin assets externos.

Las etapas futuras contemplan catálogo por categorías sin buscador, carrito,
checkout invitado (nombre, apellido, email, teléfono y domicilio para envío),
Correo Argentino o retiro, Mercado Pago con tarjetas y medios de efectivo,
transferencia con descuento y efectivo al retirar. El panel será privado para
productos, stock y pedidos. Precios, descuentos, pago y stock deberán validarse
en servidor siguiendo la arquitectura documentada antes de habilitar compras.

## VANTA — Etapa 2

El frontend ahora implementa catálogo público por categorías, páginas de producto,
galería privada de Supabase Storage, selección de talle/color y estados de carga,
error y vacío, con una nueva interfaz Dark Luxury responsive.

Configuración y arquitectura en [docs/stage-2-catalog.md](docs/stage-2-catalog.md).
La configuración sigue usando `.env.local` y las mismas dos variables públicas.
La URL del proyecto está documentada; **ninguna clave real está versionada**.
El cliente público solo consulta datos; no escribe productos, pedidos o stock.

La disponibilidad real no se expone con las políticas actuales: las variantes se
identifican como publicadas y el stock como pendiente de confirmación. No se
inventan descuentos por transferencia. El catálogo demo propuesto se mantiene
separado en `supabase/seeds/catalog.example.sql` y no se ejecuta automáticamente.
Incluye doce productos ficticios, variantes, inventario y fotografías originales.
Para ampliar los ocho modelos existentes, usar el alcance incremental de cuatro
modelos en [docs/demo-catalog-extension.md](docs/demo-catalog-extension.md).
La carga remota está pendiente de aprobación; procedimiento y controles en
[docs/demo-catalog-load.md](docs/demo-catalog-load.md).

El alcance descrito en la sección de etapa 1 queda como registro de esa entrega;
el estado actual y su validación se detallan en [docs/stage-2-review.md](docs/stage-2-review.md).
Checkout, pagos reales y panel siguen fuera de alcance.

## VANTA — Etapa 3

Carrito funcional con selección obligatoria de talle/color, cantidades, agrupación
por variante, panel lateral accesible, subtotales y total en centavos ARS. La
selección persiste en `localStorage`; precios, variantes publicadas e imágenes
firmadas se vuelven a consultar al catálogo público. Stock por confirmar.

No crea pedidos, reservas ni pagos y no requiere migraciones ni cargas remotas.
La continuación de compra permanece deshabilitada. Límites: 10 unidades por
variante y 30 variantes por carrito, sin representar disponibilidad real.

Arquitectura, prueba local, validación y pendientes en
[docs/stage-3-cart.md](docs/stage-3-cart.md).
