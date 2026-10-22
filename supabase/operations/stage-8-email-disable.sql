-- Manual, owner-reviewed stop. No order/payment/stock edits, no deletion.
begin;
update public.demo_email_config set enabled=false where singleton;
commit;
-- Also set DEMO_EMAIL_ENABLED=false in Edge and VITE_DEMO_EMAIL_ENABLED=false for a rebuilt UI.
-- Keep the private worker configured for retention maintenance; do not remove encryption keys prematurely.
