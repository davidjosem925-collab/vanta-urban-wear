-- Full schema rollback ONLY before any stage-8 activity. Otherwise use stage-8-disable.sql.
-- Does not delete payments/events/orders or alter inventory, users, factors or sessions.
begin;
do $$declare g jsonb; f regprocedure;begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 lock table public.orders,public.payments,public.payment_events,public.mp_test_config in access exclusive mode;
 if exists(select 1 from public.payments where mp_test) or exists(select 1 from public.payment_events where mp_order_id is not null)
 then raise exception 'Stage 8 activity exists: use operational disable, preserve ledger and reconciliation'; end if;
 -- Restore exactly the original direct service ACL (never invent broad grants).
 for g in select value from public.mp_test_config c cross join lateral jsonb_array_elements(c.previous_grants) loop
  if g->>'table' not in ('payments','payment_events') or g->>'privilege' not in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN') then raise exception 'Unexpected ACL snapshot'; end if;
  execute format('grant %s on public.%I to service_role%s',g->>'privilege',g->>'table',case when (g->>'grantable')::boolean then ' with grant option' else '' end);
 end loop;
end$$;
drop trigger mp_test_confirm_guard on public.orders;
-- Drop callers before internal context. No CASCADE to unrelated objects.
drop function public.mp_test_apply(uuid,text,text,jsonb),public.mp_test_prepare(uuid,text,boolean,text),public.mp_test_lookup(uuid),public.mp_test_claim_work(),public.mp_test_unlinked_result(uuid);
drop function public.mp_test_settings(),public.mp_test_claim_create(uuid),public.mp_test_accept_event(text,text),public.mp_test_claim_event(uuid),public.mp_test_finish_event(uuid,text,uuid),public.mp_test_confirm_guard(),public.mp_test_context(uuid);
drop index public.mp_test_one_payment_order;
drop index public.mp_test_due;
drop index public.mp_test_events_due;
alter table public.payments drop constraint mp_test_payment_fields,drop constraint payments_status_check,
 add constraint payments_status_check check(status in ('pending','approved','rejected','cancelled','refunded')),
 drop column mp_test,drop column mp_order_id,drop column mp_request,drop column mp_checkout_url,
 drop column mp_seller_id,drop column mp_application_id,drop column mp_provider_status,drop column mp_provider_detail,
 drop column mp_updated_at,drop column mp_reconciliation,drop column mp_next_check,drop column mp_lease_until,
 drop column mp_attempts,drop column mp_cancel_key;
alter table public.payment_events drop constraint mp_test_event_fields,drop column mp_order_id,drop column mp_lease_until,drop column mp_next_check,drop column mp_attempts,drop column mp_outcome;
drop table public.mp_test_config;
notify pgrst,'reload schema';
commit;
