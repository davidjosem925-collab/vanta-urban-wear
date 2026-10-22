-- Manual rollback AFTER rebuilding VANTA with VITE_ADMIN_EMAIL_ACCESS_ENABLED=false.
-- Existing TOTP factors/users remain; verify password + TOTP in a separate window.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
end$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select auth.jwt())->>'aal','')='aal2'
 and exists(select 1 from public.admin_profiles where user_id=(select auth.uid()) and active);
$$;
-- Restore the pre-transition category grant, still protected by AAL2 RLS.
grant insert,update,delete on public.categories to authenticated;
drop function if exists public.admin_access_mode();
notify pgrst, 'reload schema';
commit;
