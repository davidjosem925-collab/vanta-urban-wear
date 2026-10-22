-- OPTIONAL MANUAL ACTIVATION ONLY. Never part of the migration.
-- First configure Vault secrets through Dashboard: vanta_email_worker_url and vanta_email_worker_secret.
-- No secret values in this file or the cron definition. Existing expiry and payment jobs are untouched.
begin;
do $$declare target text; worker text;begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 if not exists(select 1 from pg_extension where extname='pg_cron') or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
  or to_regclass('vault.decrypted_secrets') is null then raise exception 'Verify pg_cron, pg_net and Vault manually before scheduling'; end if;
 select decrypted_secret into target from vault.decrypted_secrets where name='vanta_email_worker_url';
 select decrypted_secret into worker from vault.decrypted_secrets where name='vanta_email_worker_secret';
 if target is null or target !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/demo-email-worker$' or worker is null or length(worker)<32
 then raise exception 'Configure worker Vault entries manually'; end if;
 if exists(select 1 from cron.job where jobname='vanta-demo-email-worker' and username<>current_user) then raise exception 'Existing job has another owner'; end if;
end$$;
select cron.schedule('vanta-demo-email-worker','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='vanta_email_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='vanta_email_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=60000);
$job$);
commit;
