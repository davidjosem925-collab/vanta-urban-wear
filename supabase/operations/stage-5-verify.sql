-- Manual read-only verification after deployment, no private buyer data.
select proname,prosecdef,proconfig,proacl from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname like 'demo_%' order by proname;
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('orders','order_items','inventory','stock_reservations','inventory_movements','demo_request_limits');
select count(*) inconsistent_stock from public.inventory where reserved<0 or reserved>on_hand;
select count(*) overdue from public.orders where is_demo and status='pending' and reservation_expires_at<clock_timestamp()-interval '2 minutes';
select count(*) bad_demo_totals from public.orders o where is_demo and subtotal_cents<>(select coalesce(sum(line_total_cents),0) from public.order_items where order_id=o.id);
-- When installed: select jobname,schedule,active from cron.job where jobname like 'vanta-demo-%';
-- select status,start_time,end_time from cron.job_run_details order by start_time desc limit 10;
