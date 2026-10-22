-- Phase 2 only. Trusted owner; no external requests, secret values or historical updates.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') or to_regprocedure('public.demo_resolve_order(uuid,text)') is null or to_regprocedure('public.admin_membership()') is null
 then raise exception 'Trusted migration owner and stages 5/6 required'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^mp_test_') then raise exception 'Existing MP namespace: inspect before applying migration'; end if;
end$$;
create table public.mp_test_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 seller_id text check(seller_id ~ '^[0-9]{1,20}$'),
 application_id text check(application_id ~ '^[0-9]{1,20}$'),
 previous_grants jsonb not null,
 check(not enabled or (seller_id is not null and application_id is not null))
);
alter table public.mp_test_config enable row level security;
revoke all on public.mp_test_config from public,anon,authenticated,service_role;
insert into public.mp_test_config(previous_grants)
 select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 where n.nspname='public' and c.relname in ('payments','payment_events') and a.grantee=(select oid from pg_roles where rolname='service_role');
alter table public.payments
 drop constraint payments_status_check,
 add constraint payments_status_check check(status in ('pending','approved','rejected','cancelled','refunded','expired')),
 add column mp_test boolean not null default false,
 add column mp_order_id text unique,
 add column mp_request jsonb,
 add column mp_checkout_url text,
 add column mp_seller_id text,
 add column mp_application_id text,
 add column mp_provider_status text,
 add column mp_provider_detail text,
 add column mp_updated_at timestamptz,
 add column mp_reconciliation text,
 add column mp_next_check timestamptz,
 add column mp_lease_until timestamptz,
 add column mp_attempts integer not null default 0,
 add column mp_cancel_key uuid,
 add constraint mp_test_payment_fields check(not mp_test or coalesce((
   method='mercado_pago' and currency='ARS' and amount_cents>0 and mp_request is not null
   and mp_seller_id ~ '^[0-9]{1,20}$' and mp_application_id ~ '^[0-9]{1,20}$'
   and mp_cancel_key is not null and mp_attempts between 0 and 10000
   and mp_reconciliation in ('unlinked','awaiting','settled','review','closed')
   and (mp_order_id is null or mp_order_id ~ '^ORDTST[A-Z0-9]{10,60}$')
 ),false));
create unique index mp_test_one_payment_order on public.payments(order_id) where mp_test;
create index mp_test_due on public.payments(mp_next_check,id) where mp_test;
alter table public.payment_events
 add column mp_order_id text,
 add column mp_lease_until timestamptz,
 add column mp_next_check timestamptz,
 add column mp_attempts integer not null default 0,
 add column mp_outcome text check(mp_outcome in ('ok','retry','review','unknown_resource')),
 add constraint mp_test_event_fields check(mp_order_id is null or (
   provider='mercado_pago' and mp_order_id ~ '^ORDTST[A-Z0-9]{10,60}$'
   and event_id ~ '^mp:[a-f0-9]{64}$' and mp_attempts between 0 and 10000
 ));
create index mp_test_events_due on public.payment_events(mp_next_check,id) where mp_order_id is not null;
-- Inherited bootstrap grants were broad on unused payments. Keep reads, restrict writes.
revoke all on public.payments,public.payment_events from service_role;
grant select on public.payments,public.payment_events to service_role;
do $$declare t text; p text;begin
 foreach t in array array['payments','payment_events'] loop
 foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] loop
 if has_table_privilege('service_role','public.'||t,p) then raise exception 'Unexpected inherited payment privilege'; end if;
 end loop;end loop;
end$$;

create function public.mp_test_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'seller_id',seller_id,'application_id',application_id) from public.mp_test_config where singleton;
$$;
-- Internal context: includes the frozen provider request, never returned verbatim to guests.
create function public.mp_test_context(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('payment_id',p.id,'reference',o.public_reference,'order_status',o.status,
 'expires_at',o.reservation_expires_at,'amount_cents',p.amount_cents,'status',p.status,
 'reconciliation',p.mp_reconciliation,'provider_order_id',p.mp_order_id,'checkout_url',p.mp_checkout_url,
 'request',p.mp_request,'idempotency_key',p.idempotency_key,'cancel_key',p.mp_cancel_key,
 'seller_id',p.mp_seller_id,'application_id',p.mp_application_id,'attempts',p.mp_attempts)
 from public.payments p join public.orders o on o.id=p.order_id where p.id=p_id and p.mp_test;
$$;
create function public.mp_test_lookup(p_reference uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.mp_test_context(p.id) from public.payments p join public.orders o on o.id=p.order_id where o.public_reference=p_reference and p.mp_test;
$$;
-- create/recover authorize by capability hash, never by public reference alone.
create function public.mp_test_prepare(p_reference uuid,p_owner text,p_create boolean,p_return_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments; c public.mp_test_config; body jsonb;
begin
 if p_owner is null or p_owner !~ '^[a-f0-9]{64}$' or p_create is null then raise exception 'INVALID_REQUEST'; end if;
 select * into o from public.orders where public_reference=p_reference and is_demo and owner_hash=p_owner and demo_payment='mercado_pago' for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
  perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id;
 end if;
 select * into p from public.payments where order_id=o.id and mp_test;
 if found then return public.mp_test_context(p.id); end if;
 if not p_create then return null; end if;
 select * into c from public.mp_test_config where singleton;
 if not c.enabled then raise exception 'PAYMENTS_DISABLED'; end if;
 if o.status<>'pending' then raise exception 'ORDER_UNAVAILABLE'; end if;
 if exists(select 1 from public.payments where order_id=o.id) then raise exception 'PAYMENT_CONFLICT'; end if;
 if p_return_origin is null or length(p_return_origin)>300 or p_return_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'INVALID_REQUEST'; end if;
 body:=jsonb_build_object('type','online','processing_mode','manual','capture_mode','automatic_async',
  'total_amount',(o.subtotal_cents/100)::text||'.'||lpad((o.subtotal_cents%100)::text,2,'0'),
  'external_reference',o.public_reference::text,'expiration_time','PT1H',
  'items',(select jsonb_agg(jsonb_build_object('title',i.product_name||' / '||i.size||' / '||i.color,
   'quantity',i.quantity,'unit_price',(i.unit_price_cents/100)::text||'.'||lpad((i.unit_price_cents%100)::text,2,'0')) order by i.variant_id)
   from public.order_items i where order_id=o.id),
  'config',jsonb_build_object('online',jsonb_build_object('success_url',p_return_origin||'/#/checkout/finalizado',
   'failure_url',p_return_origin||'/#/checkout/revision','pending_url',p_return_origin||'/#/checkout/revision')));
 insert into public.payments(order_id,method,idempotency_key,amount_cents,mp_test,mp_request,mp_seller_id,mp_application_id,mp_reconciliation,mp_next_check,mp_cancel_key)
 values(o.id,'mercado_pago',gen_random_uuid(),o.subtotal_cents,true,body,c.seller_id,c.application_id,'unlinked',clock_timestamp(),gen_random_uuid()) returning * into p;
 return public.mp_test_context(p.id);
end$$;
-- No browser/admin may use the existing transition to bypass payment verification.
create function public.mp_test_confirm_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status in ('confirmed','preparing','delivered')
 and exists(select 1 from public.payments where order_id=new.id and mp_test)
 and not exists(select 1 from public.payments where order_id=new.id and mp_test and status='approved' and mp_reconciliation='settled')
 then raise exception 'PAYMENT_NOT_VERIFIED'; end if;
 return new;
end$$;
create trigger mp_test_confirm_guard before update of status on public.orders for each row execute function public.mp_test_confirm_guard();

-- A lease avoids duplicate HTTP writes. Retrying uses the same frozen body/key.
create function public.mp_test_claim_create(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments;
begin
 select q.* into o from public.orders q join public.payments x on x.order_id=q.id where x.id=p_id and x.mp_test for update of q;
 if not found then return false; end if;
 select * into p from public.payments where id=p_id for update;
 if p.mp_order_id is not null or p.mp_reconciliation='review' or p.mp_attempts>=8 or o.status<>'pending' or o.reservation_expires_at<=clock_timestamp()
 or p.mp_lease_until>clock_timestamp() or not (select enabled from public.mp_test_config where singleton) then return false; end if;
 update public.payments set mp_lease_until=clock_timestamp()+interval '30 seconds',mp_next_check=clock_timestamp()+interval '1 minute',mp_attempts=mp_attempts+1 where id=p_id;
 return true;
end$$;
-- ID/outcome fields only, not full request/response bodies.
create function public.mp_test_accept_event(p_event text,p_resource text) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if p_event is null or p_event !~ '^mp:[a-f0-9]{64}$' or p_resource is null or p_resource !~ '^ORDTST[A-Z0-9]{10,60}$' then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(58201,8);
 select id into r from public.payment_events where provider='mercado_pago' and event_id=p_event;
 if found then return r; end if;
 if (select count(*) from public.payment_events where mp_order_id is not null and status='received')>=200 then raise exception 'EVENT_CAPACITY'; end if;
 insert into public.payment_events(provider,event_id,mp_order_id,mp_next_check) values('mercado_pago',p_event,p_resource,clock_timestamp()) returning id into r;
 return r;
end$$;
create function public.mp_test_claim_event(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.payment_events set mp_lease_until=clock_timestamp()+interval '2 minutes',mp_attempts=mp_attempts+1
 where id=p_id and mp_order_id is not null and status='received' and mp_attempts<20
 and (mp_lease_until is null or mp_lease_until<=clock_timestamp());
 return found;
end$$;
create function public.mp_test_finish_event(p_id uuid,p_outcome text,p_payment uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_outcome is null or p_outcome not in ('ok','retry','review','unknown_resource') then raise exception 'INVALID_REQUEST'; end if;
 update public.payment_events set status=case when p_outcome='retry' then 'received' when p_outcome in ('review','unknown_resource') then 'failed' else 'processed' end,
 mp_outcome=p_outcome,processed_at=case when p_outcome='retry' then null else clock_timestamp() end,
 mp_next_check=clock_timestamp()+interval '5 minutes',mp_lease_until=null,
 payment_id=coalesce(payment_id,p_payment)
 where id=p_id and mp_order_id is not null and status='received'
 and (p_payment is null or exists(select 1 from public.payments p where p.id=p_payment and p.mp_test and p.mp_order_id=public.payment_events.mp_order_id));
end$$;
-- Called only with a validated API snapshot by trusted Edge, never public JWTs.
create function public.mp_test_apply(p_id uuid,p_resource text,p_url text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments; stamp timestamptz; state text; detail text; paid bigint; result text; target text;
begin
 select q.* into o from public.orders q join public.payments x on x.order_id=q.id where x.id=p_id and x.mp_test for update of q;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 select * into p from public.payments where id=p_id for update;
 if p_resource is null or p_resource !~ '^ORDTST[A-Z0-9]{10,60}$' or (p.mp_order_id is not null and p.mp_order_id<>p_resource)
 or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
 or (p_snapshot->>'reference') is distinct from o.public_reference::text
 or (p_snapshot->>'seller_id') is distinct from p.mp_seller_id or (p_snapshot->>'application_id') is distinct from p.mp_application_id
 or (p_snapshot->>'currency') is distinct from 'ARS' or (p_snapshot->>'amount_cents') is distinct from p.amount_cents::text
 or (p_snapshot->>'paid_cents') is null or (p_snapshot->>'paid_cents') !~ '^[0-9]{1,12}$' or (p_snapshot->>'updated_at') is null
 or (p_snapshot->>'state') is null or (p_snapshot->>'detail') is null
 then raise exception 'INVALID_PAYMENT'; end if;
 if p_url is not null and p_url<>('https://www.mercadopago.com.ar/checkout/v1/redirect?order_id='||p_resource) then raise exception 'INVALID_PAYMENT'; end if;
 stamp:=(p_snapshot->>'updated_at')::timestamptz; paid:=(p_snapshot->>'paid_cents')::bigint;
 state:=p_snapshot->>'state'; detail:=p_snapshot->>'detail';
 if state not in ('pending','approved','rejected','cancelled','refunded','review') or detail not in ('accredited','pending','rejected','cancelled','refunded','partial','unknown')
 or stamp>clock_timestamp()+interval '5 minutes' or paid>p.amount_cents or (state='approved' and (paid<>p.amount_cents or detail<>'accredited')) then raise exception 'INVALID_PAYMENT'; end if;
 -- Bind before state application; stale events cannot change a linked resource or URL.
 update public.payments set mp_order_id=p_resource,mp_checkout_url=coalesce(mp_checkout_url,p_url),mp_lease_until=null where id=p_id;
 if p.mp_updated_at is not null and stamp<p.mp_updated_at then return public.mp_test_context(p_id); end if;
 if (p.status in ('approved','refunded') and state in ('pending','rejected','cancelled')) or (p.status='refunded' and state='approved') then return public.mp_test_context(p_id); end if;
 result:=case when state='review' then 'review' when p.status='approved' and state='refunded' then 'review' else 'awaiting' end;
 target:=case when state='review' then p.status else state end;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
  perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id;
 end if;
 if state='approved' then
  if p.mp_reconciliation='settled' then result:='settled';
  elsif o.status='pending' then
   -- Guard sees proof in this same transaction, then primitive rechecks time AFTER inventory locks.
   update public.payments set status='approved',mp_reconciliation='settled' where id=p_id;
   perform public.demo_resolve_order(o.id,'confirmed'); select * into o from public.orders where id=o.id;
   result:=case when o.status='confirmed' then 'settled' else 'review' end;
  else result:='review'; end if;
 elsif state='cancelled' then
  if o.status='pending' then perform public.demo_resolve_order(o.id,'cancelled'); end if;
  result:='closed';
 elsif state='refunded' then result:='review';
 elsif o.status in ('expired','cancelled') then
  if state='pending' then result:='awaiting'; else result:='closed'; end if;
 end if;
 if o.status='expired' and state in ('pending','cancelled','rejected') then target:='expired'; end if;
 update public.payments set status=target,mp_provider_status=state,mp_provider_detail=detail,
 mp_updated_at=stamp,mp_reconciliation=result,mp_next_check=clock_timestamp()+case when result in ('settled','closed','review') then interval '1 hour' else interval '1 minute' end
 where id=p_id;
 return public.mp_test_context(p_id);
end$$;
-- Worker leases are short transactions. No SQL transaction spans HTTP.
create function public.mp_test_claim_work() returns jsonb language plpgsql security definer set search_path='' as $$
declare events jsonb; payments jsonb;
begin
 with picked as (select id from public.payment_events where mp_order_id is not null and status='received' and mp_attempts<20
  and mp_next_check<=clock_timestamp() and (mp_lease_until is null or mp_lease_until<=clock_timestamp()) order by mp_next_check,id limit 2 for update skip locked),
 claimed as (update public.payment_events e set mp_lease_until=clock_timestamp()+interval '2 minutes',mp_attempts=mp_attempts+1 from picked where e.id=picked.id returning e.id,e.mp_order_id)
 select coalesce(jsonb_agg(jsonb_build_object('event_id',id,'resource',mp_order_id)),'[]'::jsonb) into events from claimed;
 with picked as (select p.id from public.payments p join public.orders o on o.id=p.order_id where p.mp_test and p.mp_next_check<=clock_timestamp()
  and (p.mp_lease_until is null or p.mp_lease_until<=clock_timestamp()) and p.created_at>clock_timestamp()-interval '30 days'
  order by p.mp_next_check,p.id limit 2 for update of p skip locked),
 claimed as (update public.payments p set mp_lease_until=clock_timestamp()+interval '2 minutes',mp_next_check=clock_timestamp()+interval '5 minutes',
 mp_attempts=least(mp_attempts+case when p.mp_order_id is null then 1 else 0 end,10000) from picked where p.id=picked.id returning p.id,p.mp_attempts)
 select coalesce(jsonb_agg(public.mp_test_context(id)||jsonb_build_object('attempts',mp_attempts)),'[]'::jsonb) into payments from claimed;
 return jsonb_build_object('events',events,'payments',payments);
end$$;
-- Search found no linked resource: close local expiry or require review, never recreate after deadline.
create function public.mp_test_unlinked_result(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select q.* into o from public.orders q join public.payments p on p.order_id=q.id where p.id=p_id and p.mp_test for update of q;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id; end if;
 update public.payments set status=case when o.status='expired' then 'expired' when o.status='cancelled' then 'cancelled' else status end,
 mp_reconciliation=case when o.status in ('expired','cancelled') then 'closed' else 'review' end,
 mp_lease_until=null,mp_next_check=clock_timestamp()+interval '1 hour' where id=p_id and mp_test and mp_order_id is null;
 return public.mp_test_context(p_id);
end$$;
-- Only these narrow RPCs are exposed to Edge. Internal trigger/context are never API-callable.
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^mp_test_' loop
 execute 'revoke all on function '||f||' from public,anon,authenticated,service_role'; end loop;
end$$;
grant execute on function public.mp_test_settings(),public.mp_test_lookup(uuid),public.mp_test_prepare(uuid,text,boolean,text),public.mp_test_claim_create(uuid),public.mp_test_accept_event(text,text),public.mp_test_claim_event(uuid),public.mp_test_finish_event(uuid,text,uuid),public.mp_test_apply(uuid,text,text,jsonb),public.mp_test_claim_work(),public.mp_test_unlinked_result(uuid) to service_role;
notify pgrst,'reload schema';
commit;
