begin;
-- Extend existing concepts. Legacy commercial rows are never converted to demo rows.
alter table public.orders
  drop constraint orders_status_check,
  add constraint orders_status_check check (status in ('pending','paid','cancelled','expired','fulfilled','refunded','confirmed','preparing','delivered')),
  add column is_demo boolean not null default false,
  add column public_reference uuid unique,
  add column owner_hash text,
  add column delivery text,
  add column demo_payment text,
  add column reservation_expires_at timestamptz,
  add column reservation_resolved_at timestamptz,
  add constraint demo_order_fields check (not is_demo or (
    public_reference is not null and owner_hash is not null and owner_hash ~ '^[a-f0-9]{64}$'
    and delivery is not null and demo_payment is not null and reservation_expires_at is not null and delivery in ('shipping','pickup') and demo_payment in ('mercado_pago','transfer','cash')
    and (demo_payment <> 'cash' or delivery = 'pickup')
    and reservation_expires_at = created_at + interval '60 minutes'
    and discount_cents = 0 and shipping_cents = 0
    and ((status = 'pending' and reservation_resolved_at is null)
      or (status in ('confirmed','preparing','delivered','cancelled','expired') and reservation_resolved_at is not null))
  ));
alter table public.order_items
  add column product_id uuid references public.products(id) on delete restrict,
  add column product_description text not null default '';
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  variant_id uuid not null references public.inventory(variant_id),
  kind text not null check (kind in ('reserve','release','expire','consume','adjust')),
  quantity integer not null check (quantity between -1000 and 1000 and quantity <> 0),
  idempotency_key uuid unique,
  reason text,
  actor_id uuid default auth.uid(),
  check ((kind='adjust' and order_id is null and idempotency_key is not null and reason is not null and length(trim(reason)) between 3 and 100)
    or (kind<>'adjust' and order_id is not null and quantity between 1 and 3 and idempotency_key is null and reason is null)),
  created_at timestamptz not null default clock_timestamp(),
  unique(order_id, variant_id, kind)
);
-- Each reservation gets at most one terminal movement, even across operation types.
create unique index inventory_movements_terminal on public.inventory_movements(order_id,variant_id) where kind in ('release','expire','consume');
-- Minimal tombstones prevent reusing an old key after demo payload retention cleanup.
create table public.demo_idempotency_tombstones (
 idempotency_key uuid primary key,
 owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
 request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$')
);
alter table public.demo_idempotency_tombstones enable row level security;
revoke all on public.demo_idempotency_tombstones from public, anon, authenticated, service_role;
create table public.demo_request_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table public.inventory_movements enable row level security;
alter table public.demo_request_limits enable row level security;
revoke all on public.inventory_movements, public.demo_request_limits from public, anon, authenticated, service_role;
grant select on public.inventory_movements to authenticated;
create policy admin_read on public.inventory_movements for select to authenticated using ((select public.is_admin()));
-- The edge service may execute narrowly scoped RPCs, not perform arbitrary writes.
revoke insert, update, delete, truncate on public.orders, public.order_items, public.stock_reservations, public.inventory, public.inventory_movements from service_role;
create index demo_orders_expiry on public.orders(reservation_expires_at, id) where is_demo and status = 'pending';

create function public.demo_receipt(p_order public.orders) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('reference',p_order.public_reference,'status',p_order.status,
 'subtotal_cents',p_order.subtotal_cents,'created_at',p_order.created_at,
 'expires_at',p_order.reservation_expires_at,'demo',true);
$$;
revoke all on function public.demo_receipt(public.orders) from public, anon, authenticated, service_role;

-- Called in its own transaction: rejected/invalid requests cannot roll back the limiter.
create function public.demo_rate_limit(p_actor text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text; n integer; allowed boolean := true; t timestamptz := clock_timestamp();
begin
 if p_actor is null or p_actor !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach k in array array['actor:' || p_actor] loop
   insert into public.demo_request_limits(bucket,window_start,attempts) values(k,t,1)
   on conflict(bucket) do update set
     attempts = case when demo_request_limits.window_start <= t - interval '1 hour' then 1 else least(demo_request_limits.attempts+1,1000000) end,
     window_start = case when demo_request_limits.window_start <= t - interval '1 hour' then t else demo_request_limits.window_start end
   returning attempts into n;
   if n > 6 then allowed := false; end if;
 end loop;
 return allowed;
end $$;

-- Only after a verified challenge, in a separate committed RPC. Bad challenges
-- cannot cheaply exhaust the global creation budget for everyone else.
create function public.demo_admit_creation() returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer; t timestamptz := clock_timestamp();
begin
 insert into public.demo_request_limits(bucket,window_start,attempts) values('global',t,1)
 on conflict(bucket) do update set
 attempts=case when demo_request_limits.window_start<=t-interval '1 hour' then 1 else least(demo_request_limits.attempts+1,1000000) end,
 window_start=case when demo_request_limits.window_start<=t-interval '1 hour' then t else demo_request_limits.window_start end
 returning attempts into n;
 return n<=60;
end $$;

-- Hash is computed from normalized JSONB inside PostgreSQL, never supplied by React.
create function public.demo_order_replay(p_key uuid,p_owner text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
 select * into o from public.orders where idempotency_key=p_key;
 if not found then
   if exists(select 1 from public.demo_idempotency_tombstones where idempotency_key=p_key) then
     if exists(select 1 from public.demo_idempotency_tombstones where idempotency_key=p_key and owner_hash=p_owner and request_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex')) then raise exception 'IDEMPOTENCY_EXPIRED'; end if;
     raise exception 'IDEMPOTENCY_CONFLICT';
   end if;
   return null;
 end if;
 if not o.is_demo or o.owner_hash is distinct from p_owner
   or o.request_hash is distinct from encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') then
   raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
   perform public.demo_resolve_order(o.id,'expired');
   select * into o from public.orders where id=o.id;
 end if;
 return public.demo_receipt(o);
end $$;

create function public.demo_create_order(p_key uuid,p_owner text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 o public.orders; old jsonb; item jsonb; v record; item_id uuid;
 subtotal bigint := 0; units integer := 0; count_items integer; t timestamptz;
 qty integer;
begin
 if p_key is null or p_owner is null or p_owner !~ '^[a-f0-9]{64}$'
   or p_payload is null or jsonb_typeof(p_payload) <> 'object'
   or not (p_payload ?& array['items','delivery','payment'])
   or (p_payload - array['items','delivery','payment']) <> '{}'::jsonb
   or jsonb_typeof(p_payload->'items') <> 'array'
   or coalesce(p_payload->>'delivery','') not in ('shipping','pickup')
   or coalesce(p_payload->>'payment','') not in ('mercado_pago','transfer','cash')
   or (p_payload->>'payment' = 'cash' and p_payload->>'delivery' <> 'pickup')
 then raise exception 'INVALID_REQUEST'; end if;
 count_items := jsonb_array_length(p_payload->'items');
 if count_items not between 1 and 12 then raise exception 'INVALID_REQUEST'; end if;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
   if jsonb_typeof(item) <> 'object' or not (item ?& array['variant_id','quantity','expected_price_cents'])
     or item - array['variant_id','quantity','expected_price_cents'] <> '{}'::jsonb
     or coalesce(item->>'variant_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     or jsonb_typeof(item->'quantity') <> 'number' or coalesce(item->>'quantity','') !~ '^[1-3]$'
     or jsonb_typeof(item->'expected_price_cents') <> 'number' or coalesce(item->>'expected_price_cents','') !~ '^[0-9]{1,12}$'
   then raise exception 'INVALID_REQUEST'; end if;
   units := units + (item->>'quantity')::integer;
 end loop;
 if units > 12 or (select count(distinct value->>'variant_id') from jsonb_array_elements(p_payload->'items')) <> count_items then
   raise exception 'INVALID_REQUEST'; end if;
 -- Portfolio-scale global admission lock: makes active-order/unit caps atomic too.
 perform pg_advisory_xact_lock(58201,5);
 old := public.demo_order_replay(p_key,p_owner,p_payload);
 if old is not null then return old; end if;
 if (select count(*) from public.orders where is_demo and status='pending') >= 20
   or (select count(*) from public.orders where is_demo and status='pending' and owner_hash=p_owner) >= 2
   or coalesce((select sum(r.quantity) from public.stock_reservations r join public.orders q on q.id=r.order_id where q.is_demo and r.status='active'),0) + units > 80
 then raise exception 'DEMO_CAPACITY'; end if;
 -- Stabilize publication and prices, then inventory; always deterministic UUID ordering.
 perform c.id from public.categories c where c.id in (
   select p.category_id from public.products p join public.product_variants pv on pv.product_id=p.id
   where pv.id in (select (value->>'variant_id')::uuid from jsonb_array_elements(p_payload->'items'))
 ) order by c.id for share;
 perform p.id from public.products p where p.id in (
   select pv.product_id from public.product_variants pv where pv.id in (select (value->>'variant_id')::uuid from jsonb_array_elements(p_payload->'items'))
 ) order by p.id for share;
 perform pv.id from public.product_variants pv where pv.id in (select (value->>'variant_id')::uuid from jsonb_array_elements(p_payload->'items')) order by pv.id for share;
 perform i.variant_id from public.inventory i where i.variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(p_payload->'items')) order by i.variant_id for update;
 for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
   select pv.*,p.price_cents,p.name,p.description,p.category_id into v
   from public.product_variants pv join public.products p on p.id=pv.product_id join public.categories c on c.id=p.category_id
   where pv.id=(item->>'variant_id')::uuid and pv.active and p.active and c.active;
   if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
   if v.price_cents <> (item->>'expected_price_cents')::bigint then raise exception 'PRICE_CHANGED'; end if;
   qty := (item->>'quantity')::integer;
   if not exists(select 1 from public.inventory where variant_id=v.id and on_hand-reserved >= qty) then raise exception 'INSUFFICIENT_STOCK'; end if;
   subtotal := subtotal + v.price_cents * qty;
 end loop;
 if subtotal > 100000000000 then raise exception 'INVALID_REQUEST'; end if;
 t := clock_timestamp();
 insert into public.orders(idempotency_key,request_hash,is_demo,public_reference,owner_hash,first_name,last_name,email,phone,subtotal_cents,delivery,demo_payment,created_at,reservation_expires_at)
 values(p_key,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),true,gen_random_uuid(),p_owner,'Visitante','Demo','demo@example.invalid','00000000',subtotal,p_payload->>'delivery',p_payload->>'payment',t,t+interval '60 minutes') returning * into o;
 for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'variant_id' loop
   select pv.*,p.price_cents,p.name,p.description into v from public.product_variants pv join public.products p on p.id=pv.product_id where pv.id=(item->>'variant_id')::uuid;
   qty := (item->>'quantity')::integer;
   update public.inventory set reserved=reserved+qty where variant_id=v.id and on_hand-reserved >= qty;
   if not found then raise exception 'INSUFFICIENT_STOCK'; end if;
   insert into public.order_items(order_id,variant_id,product_id,product_name,product_description,sku,size,color,quantity,unit_price_cents)
   values(o.id,v.id,v.product_id,v.name,v.description,v.sku,v.size,v.color,qty,v.price_cents) returning id into item_id;
   insert into public.stock_reservations(order_id,order_item_id,variant_id,quantity,created_at,expires_at) values(o.id,item_id,v.id,qty,t,o.reservation_expires_at);
   insert into public.inventory_movements(order_id,variant_id,kind,quantity) values(o.id,v.id,'reserve',qty);
 end loop;
 return public.demo_receipt(o);
end $$;

-- Internal lifecycle primitive. No browser or service EXECUTE: used by audited wrappers only.
create function public.demo_resolve_order(p_id uuid,p_target text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare o public.orders; r record; kind text;
begin
 select * into o from public.orders where id=p_id and is_demo for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status <> 'pending' then return false; end if;
 if p_target not in ('cancelled','expired','confirmed') then raise exception 'INVALID_TRANSITION'; end if;
 if o.reservation_expires_at <= clock_timestamp() then p_target := 'expired';
 elsif p_target='expired' then return false; end if;
 kind := case p_target when 'confirmed' then 'consume' when 'expired' then 'expire' else 'release' end;
 perform i.variant_id from public.inventory i join public.stock_reservations s on s.variant_id=i.variant_id where s.order_id=o.id and s.status='active' order by i.variant_id for update of i;
 for r in select * from public.stock_reservations where order_id=o.id and status='active' order by variant_id for update loop
   update public.inventory set reserved=reserved-r.quantity, on_hand=on_hand-case when p_target='confirmed' then r.quantity else 0 end where variant_id=r.variant_id;
   update public.stock_reservations set status=case when p_target='confirmed' then 'consumed' when p_target='expired' then 'expired' else 'released' end where id=r.id;
   insert into public.inventory_movements(order_id,variant_id,kind,quantity) values(o.id,r.variant_id,kind,r.quantity);
 end loop;
 update public.orders set status=p_target,reservation_resolved_at=clock_timestamp() where id=o.id;
 return true;
end $$;

create function public.demo_expire_orders() returns integer
language plpgsql security definer set search_path = '' as $$
declare o record; n integer := 0;
begin
 for o in select id from public.orders where is_demo and status='pending' and reservation_expires_at<=clock_timestamp() order by id limit 100 for update skip locked loop
   if public.demo_resolve_order(o.id,'expired') then n:=n+1; end if;
 end loop;
 return n;
end $$;

-- Stage-6 hook, callable only by an authenticated active admin, never arbitrary guests.
create function public.demo_admin_transition(p_id uuid,p_target text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_id and is_demo for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status = p_target then return false; end if;
 if o.status='pending' and p_target in ('confirmed','cancelled') then return public.demo_resolve_order(o.id,p_target); end if;
 if (o.status='confirmed' and p_target='preparing') or (o.status='preparing' and p_target='delivered') then
   update public.orders set status=p_target where id=p_id; return true;
 end if;
 raise exception 'INVALID_TRANSITION';
end $$;

-- Prepared audited adjustment primitive for stage 6. No admin UI or automatic reset.
create function public.demo_admin_adjust_inventory(p_variant uuid,p_delta integer,p_reason text,p_key uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.inventory_movements; i public.inventory;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_variant is null or p_delta is null or p_delta=0 or p_delta not between -1000 and 1000 or p_reason is null or length(trim(p_reason)) not between 3 and 100 then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(58201,6);
 select * into m from public.inventory_movements where idempotency_key=p_key;
 if found then
   if m.variant_id=p_variant and m.quantity=p_delta and m.reason=p_reason then return false; end if;
   raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 select * into i from public.inventory where variant_id=p_variant for update;
 if not found or i.on_hand::bigint+p_delta < i.reserved or i.on_hand::bigint+p_delta > 1000000000 then raise exception 'INVALID_STOCK_ADJUSTMENT'; end if;
 update public.inventory set on_hand=on_hand+p_delta where variant_id=p_variant;
 insert into public.inventory_movements(variant_id,kind,quantity,idempotency_key,reason) values(p_variant,'adjust',p_delta,p_key,p_reason);
 return true;
end $$;

-- Anonymous buyers can cancel only with a high-entropy capability; no private response.
create function public.demo_cancel_order(p_reference uuid,p_owner text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare oid uuid;
begin
 select id into oid from public.orders where is_demo and public_reference=p_reference and owner_hash=p_owner;
 if oid is null then raise exception 'ORDER_UNAVAILABLE'; end if;
 return public.demo_resolve_order(oid,'cancelled');
end $$;

-- Minimized payloads already contain no supplied PII. Keep demo audit 30 days, no stock loss.
create function public.demo_cleanup() returns integer
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
 perform public.demo_expire_orders();
 select array_agg(id) into ids from (select id from public.orders o where is_demo and status in ('cancelled','expired','delivered') and created_at<clock_timestamp()-interval '30 days'
 and not exists(select 1 from public.payments p where p.order_id=o.id)
 and not exists(select 1 from public.shipments s where s.order_id=o.id)
 and not exists(select 1 from public.stock_reservations r where r.order_id=o.id and r.status='active') order by id limit 100 for update skip locked) q;
 if ids is not null then
   insert into public.demo_idempotency_tombstones(idempotency_key,owner_hash,request_hash)
   select idempotency_key,owner_hash,request_hash from public.orders where id=any(ids);
   delete from public.inventory_movements where order_id=any(ids);
   delete from public.stock_reservations where order_id=any(ids);
   delete from public.order_items where order_id=any(ids);
   delete from public.orders where id=any(ids);
 end if;
 delete from public.demo_request_limits where window_start<clock_timestamp()-interval '2 days';
 return coalesce(array_length(ids,1),0);
end $$;

do $$ declare f text; begin
 foreach f in array array['demo_admit_creation()','demo_rate_limit(text)','demo_order_replay(uuid,text,jsonb)','demo_create_order(uuid,text,jsonb)','demo_resolve_order(uuid,text)','demo_expire_orders()','demo_admin_transition(uuid,text)','demo_cancel_order(uuid,text)','demo_cleanup()','demo_admin_adjust_inventory(uuid,integer,text,uuid)'] loop
 execute 'revoke all on function public.'||f||' from public, anon, authenticated, service_role';
 end loop;
end $$;
grant execute on function public.demo_admit_creation(),public.demo_rate_limit(text),public.demo_order_replay(uuid,text,jsonb),public.demo_create_order(uuid,text,jsonb),public.demo_cancel_order(uuid,text) to service_role;
grant execute on function public.demo_admin_transition(uuid,text),public.demo_admin_adjust_inventory(uuid,integer,text,uuid) to authenticated;
-- Expiration/cleanup are database-owner jobs, not web endpoints.
commit;
