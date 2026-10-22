-- Read-only. Run as trusted owner before approving the phase-4 migration.
select to_regprocedure('public.demo_create_order(uuid,text,jsonb)') as create_order,
       to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') as verified_payment,
       to_regprocedure('public.demo_transfer_payment(uuid,text)') as transfer,
       to_regprocedure('public.demo_expire_orders()') as expiry;
-- SQL Editor installations may not have CLI migration history; function signatures above are authoritative.
select to_regclass('supabase_migrations.schema_migrations') as optional_cli_migration_history;
select extname from pg_extension where extname in ('pg_cron','pg_net');
select to_regclass('vault.decrypted_secrets') is not null as vault_available;
-- Do not select decrypted secrets, buyer data or complete outbox payloads.
