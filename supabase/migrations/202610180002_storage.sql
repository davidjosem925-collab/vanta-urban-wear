begin;
-- Private originals; only images linked to visible products can be downloaded via RLS.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',false,5242880,array['image/jpeg','image/png','image/webp','image/avif']);
create policy product_image_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'product-images' and exists (
    select 1 from public.product_images i where i.storage_path = name
  )
);
create policy admin_image_read on storage.objects for select to authenticated using (
  bucket_id = 'product-images' and (select public.is_admin())
);
create policy admin_image_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'product-images' and (select public.is_admin())
);
create policy admin_image_update on storage.objects for update to authenticated using (
  bucket_id = 'product-images' and (select public.is_admin())
) with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy admin_image_delete on storage.objects for delete to authenticated using (
  bucket_id = 'product-images' and (select public.is_admin())
);
commit;
