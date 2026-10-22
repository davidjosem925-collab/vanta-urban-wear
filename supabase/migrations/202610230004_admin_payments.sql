-- Stage 8 phase 5. No historical payment rewrite or provider credential changes.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') or to_regprocedure('public.demo_email_claim()') is null
 then raise exception 'Trusted owner and phases 2-4 required'; end if;
end$$;
create table public.demo_admin_order_actions (
 idempotency_key uuid primary key,
 order_id uuid not null references public.orders(id),
 actor_id uuid not null,
 action text not null check(action in ('confirm','cancel','prepare','deliver')),
 expected_status text not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index demo_admin_actions_order on public.demo_admin_order_actions(order_id,created_at);
alter table public.demo_admin_order_actions enable row level security;
revoke all on public.demo_admin_order_actions from public,anon,authenticated,service_role;
grant select on public.demo_admin_order_actions to authenticated;
create policy admin_read on public.demo_admin_order_actions for select to authenticated using ((select public.is_admin()));
-- Do not expose provider requests, checkout links, idempotency/cancellation keys to a browser.
revoke select on public.payments,public.payment_events from authenticated;
grant select(id,order_id,method,status,provider_payment_id,amount_cents,currency,created_at,updated_at,mp_test,mp_order_id,mp_provider_status,mp_provider_detail,mp_updated_at,mp_reconciliation) on public.payments to authenticated;
grant select(id,payment_id,provider,status,received_at,processed_at,mp_order_id,mp_outcome) on public.payment_events to authenticated;

create function public.admin_demo_order_action(p_id uuid,p_action text,p_key uuid,p_expected_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments; prior public.demo_admin_order_actions; before_status text; changed boolean:=false; r jsonb;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_id is null or p_action is null or p_action not in ('confirm','cancel','prepare','deliver')
 or p_expected_status is null or p_expected_status not in ('pending','confirmed','preparing','delivered','cancelled','expired') then raise exception 'INVALID_TRANSITION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,5820195));
 select * into prior from public.demo_admin_order_actions where idempotency_key=p_key;
 if found then
  if prior.order_id<>p_id or prior.actor_id<>auth.uid() or prior.action<>p_action or prior.expected_status<>p_expected_status then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.result;
 end if;
 select * into o from public.orders where id=p_id and is_demo for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status<>p_expected_status then raise exception 'EDIT_CONFLICT'; end if;
 select * into p from public.payments where order_id=o.id order by created_at,id limit 1 for update;
 before_status:=o.status;
 if p_action='confirm' then
  if o.demo_payment='mercado_pago' or exists(select 1 from public.payments where order_id=o.id and (mp_test or method='mercado_pago')) then raise exception 'PROVIDER_CONFIRMATION_REQUIRED'; end if;
  if o.status<>'pending' then raise exception 'INVALID_TRANSITION'; end if;
  if o.demo_payment='transfer' and (p.id is null or p.method<>'bank_transfer' or p.mp_test or p.status<>'pending'
    or p.amount_cents<>o.subtotal_cents or p.currency<>'ARS' or (select count(*) from public.payments where order_id=o.id)<>1) then raise exception 'PAYMENT_CONFLICT'; end if;
  if o.demo_payment not in ('transfer','cash') then raise exception 'INVALID_TRANSITION'; end if;
  changed:=public.demo_resolve_order(o.id,'confirmed');
  select * into o from public.orders where id=o.id;
  if p.id is not null and o.demo_payment='transfer' then
   update public.payments set status=case when o.status='confirmed' then 'approved' else 'expired' end where id=p.id;
  end if;
 elsif p_action='cancel' and o.status='pending' then
  changed:=public.demo_resolve_order(o.id,'cancelled');
  select * into o from public.orders where id=o.id;
  if p.id is not null and not p.mp_test and p.method='bank_transfer' and p.status='pending' then
   update public.payments set status=o.status where id=p.id;
  elsif p.id is not null and p.mp_test then
   update public.payments set mp_next_check=clock_timestamp() where id=p.id;
  end if;
 elsif (p_action='prepare' and o.status='confirmed') or (p_action='deliver' and o.status='preparing') then
  if o.demo_payment='mercado_pago' and not exists(select 1 from public.payments x where x.order_id=o.id and x.mp_test and x.status='approved'
   and x.amount_cents=o.subtotal_cents and x.currency='ARS' and x.mp_updated_at is not null
   and x.mp_reconciliation='settled' and x.mp_provider_status='approved' and x.mp_provider_detail='accredited' and x.mp_order_id is not null)
   then raise exception 'PROVIDER_CONFIRMATION_REQUIRED'; end if;
  update public.orders set status=case p_action when 'prepare' then 'preparing' else 'delivered' end where id=o.id returning * into o;
  changed:=true;
 else raise exception 'INVALID_TRANSITION'; end if;
 r:=jsonb_build_object('changed',changed,'order_id',o.id,'before_status',before_status,'order_status',o.status,
  'payment_status',(select status from public.payments where id=p.id),'demo',true);
 insert into public.demo_admin_order_actions(idempotency_key,order_id,actor_id,action,expected_status,result)
 values(p_key,o.id,auth.uid(),p_action,p_expected_status,r);
 return r;
end$$;
-- Existing callers keep their boolean contract, but cannot bypass payment checks/auditing.
create or replace function public.demo_admin_transition(p_id uuid,p_target text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.orders; action text; r jsonb;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_id and is_demo for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status=p_target then return false; end if;
 action:=case p_target when 'confirmed' then 'confirm' when 'cancelled' then 'cancel' when 'preparing' then 'prepare' when 'delivered' then 'deliver' end;
 if action is null then raise exception 'INVALID_TRANSITION'; end if;
 r:=public.admin_demo_order_action(p_id,action,gen_random_uuid(),o.status);
 return (r->>'changed')::boolean;
end$$;
create function public.admin_demo_order_payments(p_orders uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_orders is null or cardinality(p_orders)>20 or array_position(p_orders,null) is not null then raise exception 'INVALID_REQUEST'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',o.id,
 'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'method',p.method,'status',p.status,'amount_cents',p.amount_cents,'currency',p.currency,
  'mp_test',p.mp_test,'operation_id',coalesce(p.mp_order_id,p.provider_payment_id),'provider_status',p.mp_provider_status,'provider_detail',p.mp_provider_detail,
  'reconciliation',p.mp_reconciliation,'created_at',p.created_at,'updated_at',p.updated_at,'verified_at',p.mp_updated_at) order by p.created_at,p.id),'[]'::jsonb) from public.payments p where p.order_id=o.id),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select e.id,e.provider,e.status,e.received_at,e.processed_at,e.mp_outcome as outcome
  from public.payment_events e where e.payment_id in (select p.id from public.payments p where p.order_id=o.id)
   or (e.mp_order_id is not null and e.mp_order_id in (select p.mp_order_id from public.payments p where p.order_id=o.id)) order by e.received_at desc,e.id limit 30) e),
 'actions',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select a.action,a.expected_status,a.result,a.created_at from public.demo_admin_order_actions a where a.order_id=o.id order by a.created_at desc limit 30) a),
 'notifications',(select coalesce(jsonb_agg(jsonb_build_object('event',e.event,'state',e.state,'delivery',e.delivery,'error_code',e.error_code,'created_at',e.created_at)),'[]'::jsonb)
  from public.demo_email_outbox e where e.order_id=o.id)
 )),'[]'::jsonb) into r from public.orders o where o.is_demo and o.id=any(p_orders);
 return r;
end$$;
revoke all on function public.admin_demo_order_action(uuid,text,uuid,text),public.admin_demo_order_payments(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_demo_order_action(uuid,text,uuid,text),public.admin_demo_order_payments(uuid[]) to authenticated;
-- New terminal transitions synchronize only unpaid fictitious transfers, never MP evidence.
create function public.demo_transfer_terminal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.is_demo and new.status in ('cancelled','expired') and new.status is distinct from old.status then
  update public.payments set status=new.status where order_id=new.id and method='bank_transfer' and not mp_test and status='pending';
 end if;
 return new;
end$$;
create trigger demo_transfer_terminal after update of status on public.orders for each row execute function public.demo_transfer_terminal();
revoke all on function public.demo_transfer_terminal() from public,anon,authenticated,service_role;
-- Preserve audit evidence for old demo orders without payment rows.
create or replace function public.demo_cleanup() returns integer
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
 perform public.demo_expire_orders();
 select array_agg(id) into ids from (select id from public.orders o where is_demo and status in ('cancelled','expired','delivered') and created_at<clock_timestamp()-interval '30 days'
 and not exists(select 1 from public.demo_admin_order_actions a where a.order_id=o.id)
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
notify pgrst,'reload schema';
commit;
