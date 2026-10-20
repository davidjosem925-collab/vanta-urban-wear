-- READ ONLY; run as the trusted migration owner in the correct VANTA project.
-- Save these results before approval. No buyer data or secrets are selected.
select current_database(),current_user,version();
select to_regprocedure('pg_catalog.sha256(bytea)') builtin_sha256;
select name,default_version,installed_version from pg_available_extensions where name in ('pg_cron','pgcrypto');
select extname,extversion from pg_extension where extname in ('pg_cron','pgcrypto');
select c.relname,r.rolname owner,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner
where n.nspname='public' and c.relname in ('orders','order_items','inventory','stock_reservations','admin_profiles') order by c.relname;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name in ('orders','order_items','inventory','stock_reservations') order by table_name,ordinal_position;
select conrelid::regclass table_name,conname,pg_get_constraintdef(oid) definition from pg_constraint
where conrelid in ('public.orders'::regclass,'public.order_items'::regclass,'public.inventory'::regclass,'public.stock_reservations'::regclass) order by 1,2;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select p.oid::regprocedure signature,r.rolname owner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname='is_admin';
-- Effective privileges, including PUBLIC/inheritance; not only explicit ACL rows.
select role_name,table_name,privilege,has_table_privilege(role_name,'public.'||table_name,privilege) allowed
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['orders','order_items','inventory','stock_reservations','admin_profiles']) table_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege order by 1,2,3;
select member_role.rolname member,granted_role.rolname granted_role,m.admin_option
from pg_auth_members m join pg_roles member_role on member_role.oid=m.member join pg_roles granted_role on granted_role.oid=m.roleid
where member_role.rolname in ('anon','authenticated','service_role',current_user) order by 1,2;
select count(*) products from public.products;
select count(*) variants from public.product_variants;
select count(*) inventory_rows,min(on_hand-reserved) minimum_available,sum(on_hand) physical_units,sum(reserved) reserved_units from public.inventory;
select count(*) orders_before from public.orders;
select count(*) reservations_before from public.stock_reservations;
select p.oid::regprocedure unexpected_existing_demo_function from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'demo_%';
-- Only after pg_cron is confirmed installed: select jobname,schedule,active,username,database from cron.job;
