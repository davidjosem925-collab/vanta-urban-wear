-- READ ONLY, owner. No JWT/token/PII output. Normal SQL Editor has no user aal2:
-- is_admin() being false there is expected, not an invitation to weaken MFA.
select p.oid::regprocedure signature,r.rolname owner,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('admin_membership','is_admin','admin_save_product','admin_save_variant','admin_save_images');
select role_name,p.oid::regprocedure signature,has_function_privilege(role_name,p.oid,'EXECUTE') allowed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join unnest(array['anon','authenticated','service_role']) role_name
where n.nspname='public' and p.proname like 'admin_%' order by 1,2;
-- anon/service_role false; authenticated true for these guarded admin RPCs only.
select t,has_table_privilege('authenticated','public.'||t,'SELECT') can_select,
 has_table_privilege('authenticated','public.'||t,'INSERT') can_insert,
 has_table_privilege('authenticated','public.'||t,'UPDATE') can_update,
 has_table_privilege('authenticated','public.'||t,'DELETE') can_delete
from unnest(array['products','product_variants','product_images','inventory','orders','admin_profiles']) t;
-- SELECT remains protected by RLS. All three write privileges above must be false.
select policyname,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
-- No admin UPDATE/DELETE object policy; INSERT only product-images/vanta-admin and is_admin().
select count(*) bad_stock from public.inventory where reserved<0 or reserved>on_hand;
select count(*) bad_deadlines from public.orders where is_demo and reservation_expires_at<>created_at+interval '60 minutes';
select count(*) bad_active_demo_reservations from public.stock_reservations r join public.orders o on o.id=r.order_id where o.is_demo and r.status='active' and o.status<>'pending';
select count(*) mismatched_counters from public.inventory i where i.reserved<>(select coalesce(sum(r.quantity),0) from public.stock_reservations r where r.variant_id=i.variant_id and r.status='active');
