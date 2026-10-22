-- READ ONLY. After manual application; counts/protocol metadata only, never credentials.
select enabled,seller_id,application_id from public.mp_test_config where singleton;
select p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as guest_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as edge_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ~ '^mp_test_' order by p.proname;
select has_table_privilege('service_role','public.payments','UPDATE') as must_be_false,
 has_table_privilege('authenticated','public.payments','UPDATE') as must_also_be_false;
select status,mp_reconciliation,count(*) from public.payments where mp_test group by status,mp_reconciliation;
select status,mp_outcome,count(*) from public.payment_events where mp_order_id is not null group by status,mp_outcome;
select count(*) as invalid_inventory from public.inventory where reserved<0 or reserved>on_hand;
select count(*) as invalid_settlements from public.payments p join public.orders o on o.id=p.order_id
 where p.mp_test and p.mp_reconciliation='settled' and (p.status<>'approved' or o.status not in ('confirmed','preparing','delivered'));
select count(*) as exhausted_inbox from public.payment_events where mp_order_id is not null and status='received' and mp_attempts>=20;
select count(*) as unlinked_for_review from public.payments where mp_test and mp_order_id is null and (mp_attempts>=8 or mp_reconciliation='review');
-- Only if pg_cron is installed, separately inspect cron.job/cron.job_run_details.
-- Do not select mp_request, idempotency_key, owner_hash or Vault decrypted values for diagnostics.
