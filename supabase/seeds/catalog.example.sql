-- EJEMPLO OPCIONAL, SOLO PARA BASE LOCAL DESCARTABLE.
-- NO fue ejecutado. No ejecutar en Supabase remoto sin aprobación explícita.
-- Precios ficticios; no son una oferta comercial ni un descuento.
-- No crea inventario, pedidos, compradores, usuarios ni archivos en Storage.
begin;
insert into public.categories (name, slug, active) values
  ('Remeras', 'remeras', true), ('Buzos', 'buzos', true),
  ('Pantalones', 'pantalones', true), ('Conjuntos', 'conjuntos', true)
on conflict (slug) do nothing;

insert into public.products (category_id, name, slug, description, price_cents, active)
select c.id, d.name, d.slug, d.description, d.price_cents, true
from (values
  ('remeras', 'Remera Essential — ejemplo', 'remera-essential-ejemplo', 'Producto ficticio para desarrollo local. Silueta amplia.', 2500000::bigint),
  ('buzos', 'Buzo Core — ejemplo', 'buzo-core-ejemplo', 'Producto ficticio para desarrollo local. Capas esenciales.', 5500000::bigint),
  ('pantalones', 'Pantalón Forma — ejemplo', 'pantalon-forma-ejemplo', 'Producto ficticio para desarrollo local. Movimiento libre.', 4800000::bigint),
  ('conjuntos', 'Conjunto Studio — ejemplo', 'conjunto-studio-ejemplo', 'Producto ficticio para desarrollo local. Una misma intención.', 8000000::bigint)
) as d(category_slug, name, slug, description, price_cents)
join public.categories c on c.slug = d.category_slug
on conflict (slug) do nothing;

insert into public.product_variants (product_id, sku, size, color, active)
select p.id, 'DEMO-' || p.slug || '-' || d.suffix, d.size, d.color, true
from public.products p
cross join (values ('BLK-M','M','Negro'), ('GRY-L','L','Grafito')) as d(suffix,size,color)
where p.slug in ('remera-essential-ejemplo','buzo-core-ejemplo','pantalon-forma-ejemplo','conjunto-studio-ejemplo')
on conflict (product_id, size, color) do nothing;
commit;
