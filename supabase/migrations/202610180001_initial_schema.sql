begin;

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Membership is provisioned by a trusted database operator, never by signup metadata.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_profiles where user_id = (select auth.uid()) and active);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  price_cents bigint not null check (price_cents between 0 and 100000000000),
  currency text not null default 'ARS' check (currency = 'ARS'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique check (length(trim(storage_path)) > 0),
  alt text not null check (length(trim(alt)) > 0),
  position integer not null default 0 check (position >= 0),
  unique(product_id, position)
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null unique check (length(trim(sku)) between 1 and 100),
  size text not null check (length(trim(size)) between 1 and 30),
  color text not null check (length(trim(color)) between 1 and 60),
  active boolean not null default false,
  unique(product_id, size, color)
);
create table public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete restrict,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  updated_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  request_hash text not null check (length(request_hash) = 64),
  status text not null default 'pending' check (status in ('pending','paid','cancelled','expired','fulfilled','refunded')),
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null check (length(trim(phone)) between 6 and 40),
  currency text not null default 'ARS' check (currency = 'ARS'),
  subtotal_cents bigint not null check (subtotal_cents between 0 and 100000000000),
  discount_cents bigint not null default 0 check (discount_cents >= 0 and discount_cents <= subtotal_cents),
  shipping_cents bigint not null default 0 check (shipping_cents between 0 and 100000000000),
  total_cents bigint generated always as (subtotal_cents - discount_cents + shipping_cents) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null check (length(trim(product_name)) > 0),
  sku text not null,
  size text not null,
  color text not null,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000000),
  line_total_cents bigint generated always as (quantity::bigint * unit_price_cents) stored,
  unique(order_id, variant_id),
  unique(id, order_id, variant_id)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  method text not null check (method in ('mercado_pago','bank_transfer','cash_pickup')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','refunded')),
  provider_payment_id text unique,
  idempotency_key uuid not null unique,
  amount_cents bigint not null check (amount_cents between 0 and 200000000000),
  currency text not null default 'ARS' check (currency = 'ARS'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Only one accepted settlement per order, even across concurrent payment attempts.
create unique index payments_one_approved_order on public.payments(order_id) where status = 'approved';
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mercado_pago','manual')),
  event_id text not null,
  payment_id uuid references public.payments(id) on delete restrict,
  status text not null default 'received' check (status in ('received','processed','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, event_id)
);
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  method text not null check (method in ('correo_argentino','pickup')),
  status text not null default 'pending' check (status in ('pending','ready','shipped','delivered','cancelled')),
  street text, street_number text, apartment text, city text, province text, postal_code text,
  tracking_number text,
  created_at timestamptz not null default now(),
  check (method = 'pickup' or (
    nullif(trim(street),'') is not null and nullif(trim(street_number),'') is not null and
    nullif(trim(city),'') is not null and nullif(trim(province),'') is not null and nullif(trim(postal_code),'') is not null
  ))
);
create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null unique,
  variant_id uuid not null references public.inventory(variant_id) on delete restrict,
  quantity integer not null check (quantity between 1 and 1000),
  status text not null default 'active' check (status in ('active','consumed','released','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at),
  foreign key(order_item_id, order_id, variant_id) references public.order_items(id, order_id, variant_id) on delete restrict
);

create index products_category_idx on public.products(category_id);
create index variants_product_idx on public.product_variants(product_id);
create index orders_status_created_idx on public.orders(status, created_at);
create index items_variant_idx on public.order_items(variant_id);
create index payments_order_idx on public.payments(order_id);
create index payment_events_payment_idx on public.payment_events(payment_id);
create index reservations_order_idx on public.stock_reservations(order_id);
create index reservations_variant_idx on public.stock_reservations(variant_id);
create index reservations_expiry_idx on public.stock_reservations(expires_at) where status = 'active';

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.touch_updated_at() from public;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger inventory_touch before update on public.inventory for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();

-- Default deny, with explicit grants. Backend service_role bypasses RLS: keep it server-only.
do $$
declare t text;
begin
  foreach t in array array['admin_profiles','categories','products','product_images','product_variants','inventory','orders','order_items','payments','payment_events','shipments','stock_reservations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
  end loop;
  foreach t in array array['categories','products','product_images','product_variants'] loop
    execute format('grant select on public.%I to anon', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy admin_manage on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;
create policy public_categories on public.categories for select to anon, authenticated using (active);
create policy public_products on public.products for select to anon, authenticated using (
  active and exists(select 1 from public.categories c where c.id = category_id and c.active)
);
create policy public_images on public.product_images for select to anon, authenticated using (
  exists(select 1 from public.products p join public.categories c on c.id = p.category_id where p.id = product_id and p.active and c.active)
);
create policy public_variants on public.product_variants for select to anon, authenticated using (
  active and exists(select 1 from public.products p join public.categories c on c.id = p.category_id where p.id = product_id and p.active and c.active)
);
-- Even admins cannot directly write orders, stock, payments, reservations or their own membership.
-- Future authenticated backend endpoints must check is_admin before privileged operations.
commit;
