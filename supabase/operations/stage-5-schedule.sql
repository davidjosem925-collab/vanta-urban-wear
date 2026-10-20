-- MANUAL APPROVAL ONLY, after preflight confirms pg_cron. Enable extension via Dashboard first.
-- Run as database owner. Idempotent named jobs; no external HTTP/service key in cron.
begin;
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then
   raise exception 'pg_cron is not installed; enable it manually only after approval';
 end if;
 if not has_function_privilege(current_user,'public.demo_expire_orders()','EXECUTE')
   or not has_function_privilege(current_user,'public.demo_cleanup()','EXECUTE') then
   raise exception 'Schedule as the trusted function owner; API roles cannot execute these jobs';
 end if;
 if exists(select 1 from cron.job where jobname in ('vanta-demo-expiry','vanta-demo-retention')
   and (username<>current_user or database<>current_database())) then
   raise exception 'Named VANTA jobs belong to a different owner/database; inspect before scheduling';
 end if;
end $$;
select cron.schedule('vanta-demo-expiry','* * * * *','select public.demo_expire_orders();');
select cron.schedule('vanta-demo-retention','17 * * * *','select public.demo_cleanup();');
commit;
-- Deadline is exactly server creation +60m. The minute job releases at first tick
-- after deadline (normally <60s later); never promises execution at the exact second.
