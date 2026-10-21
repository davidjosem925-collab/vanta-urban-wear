-- READ ONLY, trusted operator. Run BEFORE approving the incremental migration.
select current_database(),current_user;
select to_regprocedure('auth.jwt()') auth_jwt,
 to_regprocedure('public.demo_admin_adjust_inventory(uuid,integer,text,uuid)') stock_rpc,
 to_regprocedure('public.admin_save_product(uuid,timestamptz,jsonb)') stage6_already_present;
select p.oid::regprocedure signature,r.rolname owner,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('is_admin','demo_admin_adjust_inventory','demo_expire_orders');
select count(*) admin_profiles,count(*) filter(where active) active_admins from public.admin_profiles;
select count(*) products from public.products;
select count(*) variants from public.product_variants;
select count(*) inventory_rows,sum(on_hand) on_hand,sum(reserved) reserved from public.inventory;
select count(*) demo_orders from public.orders where is_demo;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='product-images';
select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
-- Stage 6 must not already exist; do not reapply any prior migration.
