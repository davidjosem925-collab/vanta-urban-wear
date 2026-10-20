-- Stage 6, incremental. Apply only after explicit manual review. No data/stock reset.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 if to_regprocedure('public.demo_admin_adjust_inventory(uuid,integer,text,uuid)') is null then raise exception 'Stage 5 required'; end if;
end$$;

-- Membership is never derived from user-editable signup metadata.
create function public.admin_membership() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active);
$$;
revoke all on function public.admin_membership() from public,anon,authenticated,service_role;
grant execute on function public.admin_membership() to authenticated;
-- Harden every existing admin policy/RPC, including Storage and stock operations.
-- Does not change guest Edge creation/replay/cancellation or owner cron semantics.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select auth.jwt())->>'aal','')='aal2'
 and exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active);
$$;

-- Catalog writes use bounded, atomic RPCs. Read policies stay intact.
revoke insert,update,delete on public.products,public.product_variants,public.product_images from authenticated;
-- Original objects are immutable through the panel. Unlinking never deletes Storage.
drop policy admin_image_update on storage.objects;
drop policy admin_image_delete on storage.objects;
alter policy admin_image_insert on storage.objects with check (
 bucket_id='product-images' and name like 'vanta-admin/%' and (select public.is_admin())
);

create function public.admin_save_product(p_id uuid,p_expected timestamptz,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.products;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_values is null or jsonb_typeof(p_values)<>'object'
 or not(p_values ?& array['category_id','name','slug','description','price_cents','active'])
 or p_values-array['category_id','name','slug','description','price_cents','active']<>'{}'::jsonb
 or jsonb_typeof(p_values->'price_cents')<>'number' or coalesce(p_values->>'price_cents','')!~'^[0-9]{1,12}$'
 or (p_values->>'price_cents')::bigint>100000000000
 or jsonb_typeof(p_values->'active')<>'boolean'
 or jsonb_typeof(p_values->'name')<>'string' or jsonb_typeof(p_values->'slug')<>'string'
 or jsonb_typeof(p_values->'description')<>'string' or length(p_values->>'description')>10000
 or coalesce(p_values->>'category_id','')!~'^[a-f0-9-]{36}$'
 then raise exception 'INVALID_REQUEST'; end if;
 if p_id is null then
  if p_expected is not null then raise exception 'INVALID_REQUEST'; end if;
  insert into public.products(category_id,name,slug,description,price_cents,active)
  values((p_values->>'category_id')::uuid,p_values->>'name',p_values->>'slug',p_values->>'description',(p_values->>'price_cents')::bigint,(p_values->>'active')::boolean) returning * into r;
 else
  select * into r from public.products where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_expected is distinct from r.updated_at then raise exception 'EDIT_CONFLICT'; end if;
  update public.products set category_id=(p_values->>'category_id')::uuid,name=p_values->>'name',slug=p_values->>'slug',description=p_values->>'description',price_cents=(p_values->>'price_cents')::bigint,active=(p_values->>'active')::boolean where id=p_id returning * into r;
 end if;
 return to_jsonb(r);
end$$;

create function public.admin_save_variant(p_id uuid,p_product uuid,p_expected jsonb,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.product_variants;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 if p_values is null or jsonb_typeof(p_values)<>'object'
 or not(p_values ?& array['sku','size','color','active']) or p_values-array['sku','size','color','active']<>'{}'::jsonb
 or jsonb_typeof(p_values->'sku')<>'string' or jsonb_typeof(p_values->'size')<>'string'
 or jsonb_typeof(p_values->'color')<>'string' or jsonb_typeof(p_values->'active')<>'boolean'
 then raise exception 'INVALID_REQUEST'; end if;
 if p_id is null then
  if p_expected is not null then raise exception 'INVALID_REQUEST'; end if;
  insert into public.product_variants(product_id,sku,size,color,active) values(p_product,p_values->>'sku',p_values->>'size',p_values->>'color',(p_values->>'active')::boolean) returning * into r;
  insert into public.inventory(variant_id,on_hand,reserved) values(r.id,0,0);
 else
  select * into r from public.product_variants where id=p_id for update;
  if not found or r.product_id<>p_product then raise exception 'NOT_FOUND'; end if;
  if to_jsonb(r) is distinct from p_expected then raise exception 'EDIT_CONFLICT'; end if;
  update public.product_variants set sku=p_values->>'sku',size=p_values->>'size',color=p_values->>'color',active=(p_values->>'active')::boolean where id=p_id returning * into r;
 end if;
 return to_jsonb(r);
end$$;

-- Replace metadata atomically; never remove/overwrite an original Storage object.
-- Product lock serializes gallery editors. Complete expected snapshot prevents lost edits.
create function public.admin_save_images(p_product uuid,p_expected jsonb,p_rows jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare old jsonb; x jsonb; n integer:=0;
begin
 if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 perform id from public.products where id=p_product for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]'::jsonb) into old from public.product_images i where product_id=p_product;
 if old is distinct from p_expected then raise exception 'EDIT_CONFLICT'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>48 then raise exception 'INVALID_REQUEST'; end if;
 for x in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['storage_path','alt']) or x-array['storage_path','alt']<>'{}'::jsonb
   or jsonb_typeof(x->'storage_path')<>'string' or jsonb_typeof(x->'alt')<>'string' or length(trim(x->>'alt')) not between 1 and 300
   or not exists(select 1 from storage.objects where bucket_id='product-images' and name=x->>'storage_path')
  then raise exception 'INVALID_REQUEST'; end if;
 end loop;
 delete from public.product_images where product_id=p_product;
 for x in select value from jsonb_array_elements(p_rows) loop
  insert into public.product_images(product_id,storage_path,alt,position) values(p_product,x->>'storage_path',x->>'alt',n); n:=n+1;
 end loop;
end$$;
revoke all on function public.admin_save_product(uuid,timestamptz,jsonb),public.admin_save_variant(uuid,uuid,jsonb,jsonb),public.admin_save_images(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_product(uuid,timestamptz,jsonb),public.admin_save_variant(uuid,uuid,jsonb,jsonb),public.admin_save_images(uuid,jsonb,jsonb) to authenticated;
commit;
