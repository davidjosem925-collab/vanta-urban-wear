-- MANUAL owner only. Stop NEW creation; keep webhook/worker and expiry running.
begin;
update public.mp_test_config set enabled=false where singleton;
commit;
-- Also set MP_CHECKOUT_ENABLED=false in Edge secrets manually.
-- Do not revoke the test token or webhook secret until open attempts are reconciled.
