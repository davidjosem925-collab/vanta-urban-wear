-- Restores the exact admitted predecessor. No counters/data/ACL are reset.
begin;
do $rollback$declare f record; previous text;begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'OWNER_REQUIRED'; end if;
 if to_regprocedure('public.demo_rate_limit(text)') is null or to_regprocedure('public.demo_admit_creation()') is null
 or to_regprocedure('public.demo_create_order(uuid,text,jsonb)') is null then raise exception 'RATE_FUNCTIONS_REQUIRED'; end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_admit_creation()'::regprocedure) is distinct from '700b596387cf8e75683f5959428a7dba'
 or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_create_order(uuid,text,jsonb)'::regprocedure) is distinct from '88e1442815247686217be3a9616ec965'
 then raise exception 'UNEXPECTED_ADMISSION_OR_CAPACITY'; end if;
 for f in select * from pg_proc where oid in ('public.demo_rate_limit(text)'::regprocedure,'public.demo_admit_creation()'::regprocedure) loop
  if not f.prosecdef or f.proconfig is distinct from array['search_path=""']::text[] or f.prorettype<>'boolean'::regtype or f.proretset
   or f.proowner<>(select proowner from pg_proc where oid='public.demo_create_order(uuid,text,jsonb)'::regprocedure)
   or (select lanname from pg_language where oid=f.prolang)<>'plpgsql'
   or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or not has_function_privilege('service_role',f.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee not in (f.proowner,'service_role'::regrole::oid)
     or (a.grantee='service_role'::regrole::oid and a.is_grantable))
  then raise exception 'UNEXPECTED_RATE_SECURITY'; end if;
 end loop;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_rate_limit(text)'::regprocedure) is distinct from '61d9dc8a90848f308f95d5c87244d2cf' then raise exception 'UNEXPECTED_RATE_DEFINITION'; end if;
 previous:=obj_description('public.demo_rate_limit(text)'::regprocedure,'pg_proc');
 if previous='vanta-rate-60-v1 previous=8197059cc94f2895bb46c43dd2e867d2' then
  execute $oldrepo$create or replace function public.demo_rate_limit(p_actor text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text; n integer; allowed boolean := true; t timestamptz := clock_timestamp();
begin
 if p_actor is null or p_actor !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach k in array array['actor:' || p_actor] loop
   insert into public.demo_request_limits(bucket,window_start,attempts) values(k,t,1)
   on conflict(bucket) do update set
     attempts = case when demo_request_limits.window_start <= t - interval '1 hour' then 1 else least(demo_request_limits.attempts+1,1000000) end,
     window_start = case when demo_request_limits.window_start <= t - interval '1 hour' then t else demo_request_limits.window_start end
   returning attempts into n;
   if n > 6 then allowed := false; end if;
 end loop;
 return allowed;
end $$;$oldrepo$;
 elsif previous='vanta-rate-60-v1 previous=ac615035e8be0aab815f8b7a2b5edabb' then
  execute $oldlegacy$create or replace function public.demo_rate_limit(p_actor text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text; n integer; allowed boolean := true; t timestamptz := clock_timestamp();
begin
 if p_actor is null or p_actor !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach k in array array['actor:' || p_actor, 'global'] loop
   insert into public.demo_request_limits(bucket,window_start,attempts) values(k,t,1)
   on conflict(bucket) do update set
     attempts = case when demo_request_limits.window_start <= t - interval '1 hour' then 1 else least(demo_request_limits.attempts+1,1000000) end,
     window_start = case when demo_request_limits.window_start <= t - interval '1 hour' then t else demo_request_limits.window_start end
   returning attempts into n;
   if n > 6 then allowed := false; end if;
 end loop;
 return allowed;
end $$;$oldlegacy$;
 else raise exception 'RATE_ROLLBACK_MARKER_REQUIRED'; end if;
end$rollback$;
comment on function public.demo_rate_limit(text) is null;
commit;
