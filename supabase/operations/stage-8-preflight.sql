-- READ ONLY. Run in the selected VANTA project BEFORE approving the new migration.
select current_user as migration_actor,
 to_regprocedure('public.demo_create_order(uuid,text,jsonb)') is not null as stage5_creation,
 to_regprocedure('public.demo_resolve_order(uuid,text)') is not null as stock_primitive,
 to_regprocedure('public.admin_membership()') is not null as stage6_membership,
 to_regclass('public.mp_test_config') is not null as stage8_already_applied;
select conrelid::regclass as table_name,conname,pg_get_constraintdef(oid) as definition
 from pg_constraint where conrelid in ('public.orders'::regclass,'public.payments'::regclass,'public.payment_events'::regclass) order by 1,2;
select c.relname as table_name,has_table_privilege('service_role',c.oid,'SELECT') as service_read,
 has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
 has_table_privilege('service_role',c.oid,'UPDATE') as service_update,
 has_table_privilege('authenticated',c.oid,'UPDATE') as browser_update
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('orders','payments','payment_events','inventory');
select count(*) as invalid_inventory from public.inventory where reserved<0 or reserved>on_hand;
select count(*) as historical_payments from public.payments;
select extname,extversion from pg_extension where extname in ('pgcrypto','pg_cron','pg_net','supabase_vault');
-- No secret values, contact fields, requests, tokens or capabilities are selected.
