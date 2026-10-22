-- Read-only owner checks. No private credentials, contacts, requests or capabilities.
select to_regprocedure('public.admin_demo_order_action(uuid,text,uuid,text)') is not null as actions_installed,
       to_regprocedure('public.admin_demo_order_payments(uuid[])') is not null as metadata_installed;
select relrowsecurity from pg_class where oid='public.demo_admin_order_actions'::regclass;
select has_function_privilege('anon','public.admin_demo_order_action(uuid,text,uuid,text)','execute') as anonymous_action,
       has_function_privilege('service_role','public.admin_demo_order_action(uuid,text,uuid,text)','execute') as service_action,
       has_function_privilege('authenticated','public.admin_demo_order_action(uuid,text,uuid,text)','execute') as admin_route;
-- Expected false,false,true; is_admin() still runs for every authenticated call.
select has_column_privilege('authenticated','public.payments','idempotency_key','select') as private_key_read,
       has_column_privilege('authenticated','public.payments','mp_request','select') as provider_request_read,
       has_table_privilege('authenticated','public.payments','update') as direct_payment_write;
-- Expected false,false,false.
select action,result->>'order_status' as result_status,count(*) from public.demo_admin_order_actions group by 1,2;
select o.status as order_status,p.method,p.status as payment_status,p.mp_test,p.mp_reconciliation,count(*)
 from public.orders o left join public.payments p on p.order_id=o.id where o.is_demo group by 1,2,3,4,5;
select min(on_hand-reserved) as minimum_available,count(*) filter(where reserved<0 or on_hand<reserved) as invalid_inventory from public.inventory;
select count(*) as unpaid_terminal_transfer_mismatches from public.payments p join public.orders o on o.id=p.order_id
 where o.is_demo and o.status in ('expired','cancelled') and p.method='bank_transfer' and not p.mp_test and p.status='pending';
-- Existing historical mismatches are reported only, not rewritten by this migration.
select jobname,schedule,active from cron.job where jobname in ('vanta-demo-expiry','vanta-mp-reconcile','vanta-demo-email-worker');
select id,status_code,timed_out,created from net._http_response order by id desc limit 10;
-- Inspect statuses only. cron success alone is not HTTP success. Do not select headers/content.
