-- Owner-reviewed only. With audit activity preserve evidence and use feature/UI rollback instead.
begin;
do $$begin
 if exists(select 1 from public.demo_admin_order_actions) then raise exception 'Admin activity exists: preserve audit evidence'; end if;
end$$;
drop trigger demo_transfer_terminal on public.orders;
drop function public.demo_transfer_terminal();
drop function public.admin_demo_order_payments(uuid[]);
create or replace function public.demo_admin_transition(p_id uuid,p_target text) returns boolean
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


drop function public.admin_demo_order_action(uuid,text,uuid,text);
create or replace function public.demo_cleanup() returns integer
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
drop table public.demo_admin_order_actions;
-- Restore original admin-read privileges; RLS is unchanged. No data writes.
grant select on public.payments,public.payment_events to authenticated;
notify pgrst,'reload schema';
commit;
