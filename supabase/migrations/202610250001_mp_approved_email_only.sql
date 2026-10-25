-- Email policy only. Pause/drain email workers before applying. No order/payment/stock updates.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'OWNER_REQUIRED'; end if;
 if to_regclass('public.payments') is null or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='mp_paid_evidence') then raise exception 'PAYMENT_EVIDENCE_REQUIRED'; end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_email_eligible(uuid,text)'::regprocedure) is distinct from '1dec6dc00084c0bcb29fd45a432dc843' then raise exception 'UNEXPECTED_EMAIL_RPC'; end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_email_maintenance()'::regprocedure) is distinct from 'abb85c882d3d178a856d3f576645822a' then raise exception 'UNEXPECTED_EMAIL_RPC'; end if;
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.demo_email_begin(uuid,uuid)'::regprocedure) is distinct from '34e71f7817e00b96ccdf8f66f803eebd' then raise exception 'UNEXPECTED_EMAIL_RPC'; end if;
end$$;
create or replace function public.demo_email_eligible(p_order uuid,p_event text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select o.is_demo and (o.demo_payment is distinct from 'mercado_pago' or p_event='payment_approved') and case p_event
 when 'order_received' then true
 when 'payment_pending' then o.status='pending' and exists(select 1 from public.payments p where p.order_id=o.id and p.status='pending'
   and ((p.method='bank_transfer' and not p.mp_test) or (p.mp_test and p.mp_order_id is not null and p.mp_provider_status='pending' and p.mp_updated_at is not null)))
 when 'payment_approved' then o.status in ('confirmed','preparing','delivered') and exists(select 1 from public.payments p where p.order_id=o.id
   and p.mp_test and p.method='mercado_pago' and p.status='approved' and p.mp_reconciliation='settled'
   and p.mp_paid_evidence='reported' and p.mp_paid_amount_cents=p.amount_cents and p.amount_cents=o.total_cents
   and p.mp_order_id is not null and p.mp_provider_status='approved' and p.mp_provider_detail='accredited' and p.mp_updated_at is not null)
 when 'order_cancelled' then o.status='cancelled'
 when 'reservation_expired' then o.status='expired'
 when 'payment_review' then exists(select 1 from public.payments p where p.order_id=o.id and p.mp_test and p.mp_reconciliation='review')
 else false end from public.orders o where o.id=p_order),false);
$$;
create or replace function public.demo_email_maintenance() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Stop obsolete MP jobs, including frozen retries; accepted messages remain untouched.
 update public.demo_email_outbox e set state='suppressed',lease_id=null,lease_until=null,next_attempt_at=null,updated_at=clock_timestamp()
 from public.orders o where o.id=e.order_id and o.demo_payment='mercado_pago' and e.event<>'payment_approved'
 and e.state in ('queued','sending') and e.provider_id is null;
 -- Privacy maintenance independent of sending enablement. Does not touch orders, payments or inventory.
 update public.demo_email_contacts set recipient_ciphertext=null where order_id in (select order_id from public.demo_email_contacts where recipient_ciphertext is not null and expires_at<=clock_timestamp() order by expires_at limit 100);
 update public.demo_email_outbox set request_ciphertext=null,request_hash=null,payload=null,state=case when provider_id is null then 'suppressed' else state end,
  next_attempt_at=null,next_poll_at=null,error_code='RETENTION' where id in (select id from public.demo_email_outbox where created_at<clock_timestamp()-interval '30 days' and payload is not null order by created_at limit 100);
 delete from public.demo_email_outbox where id in (select id from public.demo_email_outbox where created_at<clock_timestamp()-interval '90 days' order by created_at limit 100);
 delete from public.demo_email_contacts where order_id in (select c.order_id from public.demo_email_contacts c where c.expires_at<clock_timestamp()-interval '60 days' and not exists(select 1 from public.demo_email_outbox e where e.order_id=c.order_id) order by c.expires_at limit 100);
 delete from public.demo_email_budget where day<(clock_timestamp() at time zone 'UTC')::date-2;
end$$;
create or replace function public.demo_email_begin(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.demo_email_outbox; lim integer; used integer; d date;
begin
 select * into e from public.demo_email_outbox where id=p_id and lease_id=p_lease and lease_until>clock_timestamp() and state='sending' for update;
 if not found then return false; end if;
 if exists(select 1 from public.orders o where o.id=e.order_id and o.demo_payment='mercado_pago' and e.event<>'payment_approved') then
  update public.demo_email_outbox set state='suppressed',lease_id=null,lease_until=null,next_attempt_at=null,updated_at=clock_timestamp() where id=p_id;
  return false;
 end if;
 if not (select enabled from public.demo_email_config where singleton) or e.request_ciphertext is null then return false; end if;
 if e.first_attempt_at is null and not public.demo_email_eligible(e.order_id,e.event) then
  update public.demo_email_outbox set state='suppressed',lease_id=null,lease_until=null,next_attempt_at=null where id=p_id;return false;
 end if;
 if e.send_attempts>=8 or e.first_attempt_at<=clock_timestamp()-interval '23 hours' then
  update public.demo_email_outbox set state='review',error_code='IDEMPOTENCY_WINDOW',lease_id=null,lease_until=null,next_attempt_at=null where id=p_id;return false;
 end if;
 -- Check suppression again immediately before HTTP, without reading or changing inventory.
 if exists(select 1 from public.demo_email_contacts c join public.demo_email_suppressions s on s.recipient_hash=c.recipient_hash where c.order_id=e.order_id) then
  update public.demo_email_outbox set state='suppressed',error_code='RECIPIENT_BLOCKED',lease_id=null,lease_until=null,next_attempt_at=null where id=p_id;return false;
 end if;
 perform pg_advisory_xact_lock(58201,94);
 d:=(clock_timestamp() at time zone 'UTC')::date;
 select daily_attempt_limit into lim from public.demo_email_config where singleton;
 select attempts into used from public.demo_email_budget where day=d;
 if coalesce(used,0)>=lim then
  update public.demo_email_outbox set state='queued',lease_id=null,lease_until=null,next_attempt_at=(d+1)::timestamp at time zone 'UTC' where id=p_id;return false;
 end if;
 insert into public.demo_email_budget(day,attempts) values(d,1) on conflict(day) do update set attempts=demo_email_budget.attempts+1;
 update public.demo_email_outbox set first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),send_attempts=send_attempts+1,updated_at=clock_timestamp() where id=p_id;
 return true;
end$$;
-- One-time suppression; never rewrite frozen requests or accepted/sent records.
 update public.demo_email_outbox e set state='suppressed',lease_id=null,lease_until=null,next_attempt_at=null,updated_at=clock_timestamp()
 from public.orders o where o.id=e.order_id and o.demo_payment='mercado_pago' and e.event<>'payment_approved'
 and e.state in ('queued','sending') and e.provider_id is null;
commit;
