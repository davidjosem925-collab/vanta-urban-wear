-- Full phase-4 schema rollback ONLY before any enrollment/sending activity.
-- With activity use stage-8-email-disable.sql; preserve delivery evidence and privacy maintenance.
begin;
do $$begin
 if exists(select 1 from public.demo_email_contacts) or exists(select 1 from public.demo_email_outbox)
 or exists(select 1 from public.demo_email_budget) or exists(select 1 from public.demo_email_suppressions)
 then raise exception 'Email activity exists: disable only; do not discard delivery evidence'; end if;
end$$;
drop trigger demo_email_order_event on public.orders;
drop trigger demo_email_payment_event on public.payments;
create or replace function public.demo_receipt(p_order public.orders) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('reference',p_order.public_reference,'status',p_order.status,
 'subtotal_cents',p_order.subtotal_cents,'created_at',p_order.created_at,
 'expires_at',p_order.reservation_expires_at,'demo',true);
$$;
revoke all on function public.demo_receipt(public.orders) from public, anon, authenticated, service_role;


drop function public.demo_email_create_order(uuid,text,jsonb,text,text);
drop function public.demo_email_claim();
drop function public.demo_email_freeze(uuid,uuid,text,text);
drop function public.demo_email_begin(uuid,uuid);
drop function public.demo_email_result(uuid,uuid,text,uuid,integer);
drop function public.demo_email_delivery(uuid,uuid,uuid,text,integer);
drop function public.demo_email_order_event();
drop function public.demo_email_payment_event();
drop function public.demo_email_enqueue(uuid,text);
drop function public.demo_email_eligible(uuid,text);
drop function public.demo_email_maintenance();
drop table public.demo_email_outbox;
drop table public.demo_email_contacts;
drop table public.demo_email_suppressions;
drop table public.demo_email_budget;
drop table public.demo_email_config;
notify pgrst,'reload schema';
commit;
