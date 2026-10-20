-- READ ONLY after migration, as trusted owner. No PII.
select current_database(),current_user;
select p.oid::regprocedure signature,r.rolname owner,r.rolsuper,r.rolbypassrls,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname like 'demo_%' order by 1;
-- Expected: all anon=false. authenticated=true ONLY for the two guarded admin RPCs.
-- service_role=true ONLY for admit/rate/replay/create/cancel. Jobs/helpers=false.
select role_name,p.oid::regprocedure signature,has_function_privilege(role_name,p.oid,'EXECUTE') allowed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join unnest(array['anon','authenticated','service_role']) role_name
where n.nspname='public' and p.proname like 'demo_%' order by 1,2;
select role_name,table_name,privilege,has_table_privilege(role_name,'public.'||table_name,privilege) allowed
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['orders','order_items','inventory','stock_reservations','inventory_movements']) table_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege order by 1,2,3;
-- All API roles: write/TRIGGER/REFERENCES=false. authenticated SELECT uses admin_read RLS.
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('orders','order_items','inventory','stock_reservations','inventory_movements','demo_request_limits','demo_idempotency_tombstones');
select tablename,policyname,roles,cmd,qual from pg_policies where schemaname='public' and tablename in ('orders','order_items','inventory','stock_reservations','inventory_movements');
select count(*) products from public.products;
select count(*) variants from public.product_variants;
select count(*) inventory_rows,min(on_hand-reserved) minimum_available,sum(on_hand) physical_units,sum(reserved) reserved_units from public.inventory;
-- Expected 0 in all invariant/overdue counts after the job has had time to run.
select count(*) inconsistent_stock from public.inventory where reserved<0 or reserved>on_hand;
select count(*) overdue from public.orders where is_demo and status='pending' and reservation_expires_at<clock_timestamp()-interval '2 minutes';
select count(*) bad_demo_deadlines from public.orders where is_demo and reservation_expires_at<>created_at+interval '60 minutes';
select count(*) bad_demo_totals from public.orders o where is_demo and subtotal_cents<>(select coalesce(sum(line_total_cents),0) from public.order_items where order_id=o.id);
select count(*) bad_demo_reservations from public.stock_reservations s join public.orders o on o.id=s.order_id join public.order_items i on i.id=s.order_item_id where o.is_demo and (s.quantity<>i.quantity or s.expires_at<>o.reservation_expires_at or (s.status='active' and o.status<>'pending'));
-- Includes all existing reservations; investigate legacy mismatches before enabling demo.
select count(*) mismatched_reserved_counters from public.inventory i where i.reserved<>(select coalesce(sum(s.quantity),0) from public.stock_reservations s where s.variant_id=i.variant_id and s.status='active');
-- When installed, run separately (do not un-comment before pg_cron exists):
-- select jobid,jobname,schedule,active,username,database from cron.job where jobname in ('vanta-demo-expiry','vanta-demo-retention');
-- select d.jobid,d.status,d.start_time,d.end_time from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname in ('vanta-demo-expiry','vanta-demo-retention') order by d.start_time desc limit 10;
