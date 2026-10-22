-- OPTIONAL transition for this portfolio demo. Explicit owner approval required.
-- No Auth configuration/factor/data writes. Read-only use of documented session_id.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 if to_regprocedure('public.admin_save_product(uuid,timestamptz,jsonb)') is null
    or to_regclass('auth.sessions') is null then raise exception 'Stage 6 and Auth sessions required'; end if;
end$$;

-- Presentation handshake, not authorization. Only the migration activates this mode.
create function public.admin_access_mode() returns text
language sql stable security invoker set search_path='' as $$ select 'email'::text $$;
revoke all on function public.admin_access_mode() from public,anon,authenticated,service_role;
grant execute on function public.admin_access_mode() to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select auth.jwt())->>'role','')='authenticated'
 and coalesce((select auth.jwt())->>'aal','') in ('aal1','aal2')
 and exists(select 1 from public.admin_profiles p
   join auth.users u on u.id=p.user_id
   join auth.sessions s on s.user_id=u.id
   where p.user_id=(select auth.uid()) and p.active
     and u.email_confirmed_at is not null
     and (u.banned_until is null or u.banned_until<=statement_timestamp())
     and s.id::text=coalesce((select auth.jwt())->>'session_id','')
     and s.created_at>statement_timestamp()-interval '7 days'
     and (s.not_after is null or s.not_after>statement_timestamp()));
$$;
-- CREATE OR REPLACE preserves existing EXECUTE grants used by public policies.
-- Category editing is not exposed by an authorized RPC/panel; close this unused
-- direct-write grant rather than expanding AAL1 direct catalog writes.
revoke insert,update,delete on public.categories from authenticated;
-- No policies, other table grants, RPC bodies or stock/reservation logic change.
notify pgrst, 'reload schema';
commit;
