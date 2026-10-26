-- READ ONLY: run before approving activation. Any exception means STOP.
do $$declare f record; previous text;begin
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
 previous:= (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_rate_limit(text)'::regprocedure);
 if previous not in ('8197059cc94f2895bb46c43dd2e867d2','ac615035e8be0aab815f8b7a2b5edabb') or obj_description('public.demo_rate_limit(text)'::regprocedure,'pg_proc') is not null
 then raise exception 'UNEXPECTED_RATE_DEFINITION'; end if;
end$$;
select p.oid::regprocedure as function_name,md5(replace(p.prosrc,E'\r\n',E'\n')) as body_md5,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p where p.oid in ('public.demo_rate_limit(text)'::regprocedure,'public.demo_admit_creation()'::regprocedure);
select count(*) as active_global_buckets,max(attempts) as global_attempts,max(window_start+interval '1 hour') as global_window_end
from public.demo_request_limits where bucket='global' and window_start>clock_timestamp()-interval '1 hour';
