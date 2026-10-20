-- MANUAL APPROVAL ONLY, after preflight confirms pg_cron. Enable extension via Dashboard first.
-- Run as database owner. Idempotent named jobs; no external HTTP/service key in cron.
begin;
select cron.schedule('vanta-demo-expiry','* * * * *','select public.demo_expire_orders();');
select cron.schedule('vanta-demo-retention','17 * * * *','select public.demo_cleanup();');
commit;
-- Deadline is exactly server creation +60m. The minute job releases at first tick
-- after deadline (normally <60s later); never promises execution at the exact second.
