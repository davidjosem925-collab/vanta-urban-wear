-- Read-only trusted-owner checks. No addresses, ciphertext, request bodies or secrets.
select enabled,daily_attempt_limit from public.demo_email_config;
select state,event,delivery,error_code,count(*) from public.demo_email_outbox
 group by state,event,delivery,error_code order by event,state,delivery;
select day,attempts from public.demo_email_budget order by day desc limit 7;
select count(*) as expired_contacts_pending_cleanup from public.demo_email_contacts
 where expires_at<clock_timestamp() and recipient_ciphertext is not null;
select count(*) as held_leases from public.demo_email_outbox where lease_until>clock_timestamp();
select relname,relrowsecurity from pg_class where oid in (
 'public.demo_email_config'::regclass,'public.demo_email_contacts'::regclass,
 'public.demo_email_outbox'::regclass,'public.demo_email_budget'::regclass,'public.demo_email_suppressions'::regclass);
select grantee,table_name,privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name like 'demo_email_%'
 and grantee in ('anon','authenticated','service_role','PUBLIC'); -- Expected: zero rows.
select has_function_privilege('anon','public.demo_email_claim()','execute') as anon_claim,
 has_function_privilege('authenticated','public.demo_email_claim()','execute') as user_claim,
 has_function_privilege('service_role','public.demo_email_claim()','execute') as worker_claim;
-- Expected false,false,true. Inspect the other email RPCs similarly; helpers have NO service EXECUTE.
-- Inspect cron.job_run_details AND net._http_response HTTP status, without selecting headers/content.
