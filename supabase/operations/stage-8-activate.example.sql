-- MANUAL AFTER REVIEW/DEPLOY/IDENTITY VERIFICATION. No tokens go in SQL.
-- Fill only the two numeric IDs from the verified TEST seller/application.
begin;
do $$declare seller text:=''; application text:='';begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Trusted owner required'; end if;
 if seller !~ '^[0-9]{1,20}$' or application !~ '^[0-9]{1,20}$' then raise exception 'Configure verified test IDs before activation'; end if;
 update public.mp_test_config set seller_id=seller,application_id=application,enabled=true where singleton;
 if not found then raise exception 'Apply phase-2 migration first'; end if;
end$$;
commit;
-- Independent Edge MP_CHECKOUT_ENABLED must also be explicitly enabled.
