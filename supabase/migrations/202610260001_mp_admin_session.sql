-- Incremental, owner-reviewed activation only. Never applied by the audit.
begin;
create function public.mp_checkout_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select auth.jwt())->>'role','')='authenticated'
 and public.is_admin()
 and exists (
   select 1 from auth.sessions s
   join auth.users u on u.id=s.user_id
   where s.user_id=(select auth.uid())
     and s.id::text=coalesce((select auth.jwt())->>'session_id','')
     and (s.not_after is null or s.not_after>statement_timestamp())
     and u.email_confirmed_at is not null
     and (u.banned_until is null or u.banned_until<=statement_timestamp())
 );
$$;
revoke all on function public.mp_checkout_is_admin() from public,anon,authenticated,service_role;
grant execute on function public.mp_checkout_is_admin() to authenticated;
notify pgrst, 'reload schema';
commit;
