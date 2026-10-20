-- READ ONLY. Run manually before approving migration/cron. Never prints PII.
select version();
select name,default_version,installed_version from pg_available_extensions where name in ('pg_cron','pgcrypto');
select extname,extversion from pg_extension where extname in ('pg_cron','pgcrypto');
select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('orders','order_items','inventory','stock_reservations') order by table_name,ordinal_position;
select tablename,policyname,roles,cmd from pg_policies where schemaname='public' order by tablename,policyname;
select count(*) products from public.products;
select count(*) variants from public.product_variants;
select count(*) inventory_rows, min(on_hand-reserved) minimum_available from public.inventory;
-- Only after pg_cron is confirmed installed: select jobname,schedule,active from cron.job;
