-- MANUAL ONLY after deploying reviewed functions and configuring private secrets.
-- Migration defaults OFF. Confirm allowed recipients and sender before executing.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 update public.demo_email_config set enabled=true, daily_attempt_limit=50 where singleton;
 if not found then raise exception 'Apply phase-4 migration first'; end if;
end$$;
commit;
-- Edge DEMO_EMAIL_ENABLED=true is also required. Enable the frontend flag last.
