-- Stage 8 phase 4. No historical enrollment, HTTP calls, stock or payment rewrites.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') or to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') is null
 or to_regprocedure('public.demo_transfer_payment(uuid,text)') is null then raise exception 'Trusted owner and phases 2/3 required'; end if;
end$$;
create table public.demo_email_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 daily_attempt_limit integer not null default 50 check(daily_attempt_limit between 1 and 100)
);
insert into public.demo_email_config default values;
create table public.demo_email_contacts (
 order_id uuid primary key references public.orders(id) on delete cascade,
 context_key uuid not null,
 recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
 recipient_ciphertext text check(length(recipient_ciphertext) between 40 and 2048 and recipient_ciphertext ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'),
 expires_at timestamptz not null default clock_timestamp()+interval '30 days',
 created_at timestamptz not null default clock_timestamp()
);
create table public.demo_email_outbox (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 event text not null check(event in ('order_received','payment_pending','payment_approved','order_cancelled','reservation_expired','payment_review')),
 payload jsonb,
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','review','suppressed')),
 request_ciphertext text,
 request_hash text check(request_hash ~ '^[a-f0-9]{64}$'),
 first_attempt_at timestamptz,
 send_attempts integer not null default 0 check(send_attempts between 0 and 8),
 claim_attempts integer not null default 0 check(claim_attempts between 0 and 32),
 next_attempt_at timestamptz default clock_timestamp(),
 lease_id uuid,
 lease_until timestamptz,
 provider_id uuid unique,
 delivery text not null default 'unknown' check(delivery in ('unknown','sent','delayed','delivered','bounced','complained','failed','suppressed')),
 poll_attempts integer not null default 0 check(poll_attempts between 0 and 12),
 next_poll_at timestamptz,
 error_code text check(error_code in ('NETWORK','TIMEOUT','HTTP_RETRY','PROVIDER_AUTH','PROVIDER_REJECTED','IDEMPOTENCY_CONFLICT','INVALID_RESPONSE','INVALID_DATA','RECIPIENT_BLOCKED','KEY_UNAVAILABLE','RETRY_EXHAUSTED','IDEMPOTENCY_WINDOW','DELIVERY_UNCONFIRMED','RETENTION')),
 accepted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(order_id,event),
 check(payload is null or (jsonb_typeof(payload)='object' and octet_length(payload::text)<=32768)),
 check((request_ciphertext is null and request_hash is null) or
  (length(request_ciphertext) between 40 and 200000 and request_ciphertext ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' and request_hash is not null)),
 check(provider_id is null or state='accepted')
);
create index demo_email_contact_expiry on public.demo_email_contacts(expires_at);
create index demo_email_retention on public.demo_email_outbox(created_at);
create index demo_email_send_due on public.demo_email_outbox(next_attempt_at,id) where state in ('queued','sending');
create index demo_email_poll_due on public.demo_email_outbox(next_poll_at,id) where state='accepted';
create table public.demo_email_budget (
 day date primary key,
 attempts integer not null check(attempts between 1 and 100)
);
create table public.demo_email_suppressions (
 recipient_hash text primary key check(recipient_hash ~ '^[a-f0-9]{64}$'),
 reason text not null check(reason in ('bounced','complained','suppressed')),
 created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['demo_email_config','demo_email_contacts','demo_email_outbox','demo_email_budget','demo_email_suppressions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
-- Eligibility is derived from server records, not a browser event or an order status alone.
create function public.demo_email_eligible(p_order uuid,p_event text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select o.is_demo and case p_event
 when 'order_received' then true
 when 'payment_pending' then o.status='pending' and exists(select 1 from public.payments p where p.order_id=o.id and p.status='pending'
   and ((p.method='bank_transfer' and not p.mp_test) or (p.mp_test and p.mp_order_id is not null and p.mp_provider_status='pending' and p.mp_updated_at is not null)))
 when 'payment_approved' then o.status in ('confirmed','preparing','delivered') and exists(select 1 from public.payments p where p.order_id=o.id
   and p.mp_test and p.method='mercado_pago' and p.status='approved' and p.mp_reconciliation='settled'
   and p.mp_order_id is not null and p.mp_provider_status='approved' and p.mp_provider_detail='accredited' and p.mp_updated_at is not null)
 when 'order_cancelled' then o.status='cancelled'
 when 'reservation_expired' then o.status='expired'
 when 'payment_review' then exists(select 1 from public.payments p where p.order_id=o.id and p.mp_test and p.mp_reconciliation='review')
 else false end from public.orders o where o.id=p_order),false);
$$;
create function public.demo_email_enqueue(p_order uuid,p_event text) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; pay public.payments; snap jsonb;
begin
 if not (select enabled from public.demo_email_config where singleton)
 or not exists(select 1 from public.demo_email_contacts c where c.order_id=p_order and c.recipient_ciphertext is not null and c.expires_at>clock_timestamp())
 or not public.demo_email_eligible(p_order,p_event) then return; end if;
 select * into o from public.orders where id=p_order and is_demo;
 if not found then return; end if;
 select * into pay from public.payments where order_id=o.id order by created_at desc,id desc limit 1;
 snap:=jsonb_build_object('version',1,'reference',o.public_reference,'event',p_event,'event_at',clock_timestamp(),
  'order_status',o.status,'payment_status',coalesce(pay.status,'pending'),'method',o.demo_payment,'delivery',o.delivery,
  'subtotal_cents',o.subtotal_cents,'shipping_cents',o.shipping_cents,'total_cents',o.total_cents,'currency',o.currency,
  'expires_at',o.reservation_expires_at,
  'items',(select jsonb_agg(jsonb_build_object('name',i.product_name,'size',i.size,'color',i.color,
    'quantity',i.quantity,'unit_price_cents',i.unit_price_cents) order by i.variant_id) from public.order_items i where i.order_id=o.id));
 insert into public.demo_email_outbox(order_id,event,payload) values(o.id,p_event,snap) on conflict(order_id,event) do nothing;
 -- Unstarted pending messages are obsolete after terminal/review evidence. Never rewrite a frozen request.
 if p_event in ('payment_approved','order_cancelled','reservation_expired','payment_review') then
  update public.demo_email_outbox set state='suppressed',next_attempt_at=null,updated_at=clock_timestamp()
   where order_id=o.id and event='payment_pending' and state='queued' and first_attempt_at is null and request_ciphertext is null;
 end if;
end$$;
create function public.demo_email_order_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.is_demo and new.status is distinct from old.status then
  if new.status='cancelled' then perform public.demo_email_enqueue(new.id,'order_cancelled');
  elsif new.status='expired' then perform public.demo_email_enqueue(new.id,'reservation_expired'); end if;
 end if;
 return new;
end$$;
create trigger demo_email_order_event after update of status on public.orders for each row execute function public.demo_email_order_event();
create function public.demo_email_payment_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.mp_test or new.method='bank_transfer' then
  perform public.demo_email_enqueue(new.order_id,'payment_pending');
  perform public.demo_email_enqueue(new.order_id,'payment_approved');
  perform public.demo_email_enqueue(new.order_id,'payment_review');
 end if;
 return new;
end$$;
create trigger demo_email_payment_event after insert or update on public.payments for each row execute function public.demo_email_payment_event();
-- Same public receipt plus a non-PII request acknowledgement. Existing clients ignore the extra field.
create or replace function public.demo_receipt(p_order public.orders) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('reference',p_order.public_reference,'status',p_order.status,
  'subtotal_cents',p_order.subtotal_cents,'created_at',p_order.created_at,'expires_at',p_order.reservation_expires_at,'demo',true,
  'email_requested',exists(select 1 from public.demo_email_contacts c where c.order_id=p_order.id));
$$;
create function public.demo_email_create_order(p_key uuid,p_owner text,p_payload jsonb,p_recipient_hash text,p_ciphertext text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb; r jsonb; o public.orders;
begin
 -- Same admission lock as demo_create_order: atomic across both notified and legacy concurrent creation.
 perform pg_advisory_xact_lock(58201,5);
 prior:=public.demo_order_replay(p_key,p_owner,p_payload);
 if prior is not null then return prior; end if; -- No historical enrollment or recipient retargeting.
 if not (select enabled from public.demo_email_config where singleton) then raise exception 'EMAIL_DISABLED'; end if;
 if p_recipient_hash is null or p_recipient_hash !~ '^[a-f0-9]{64}$' or p_ciphertext is null
 or length(p_ciphertext) not between 40 and 2048 or p_ciphertext !~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' then raise exception 'INVALID_EMAIL'; end if;
 if exists(select 1 from public.demo_email_suppressions where recipient_hash=p_recipient_hash) then raise exception 'EMAIL_RECIPIENT_UNAVAILABLE'; end if;
 r:=public.demo_create_order(p_key,p_owner,p_payload);
 select * into o from public.orders where public_reference=(r->>'reference')::uuid;
 insert into public.demo_email_contacts(order_id,context_key,recipient_hash,recipient_ciphertext) values(o.id,p_key,p_recipient_hash,p_ciphertext);
 perform public.demo_email_enqueue(o.id,'order_received');
 return public.demo_receipt(o);
end$$;
-- Bounded retention maintenance can run while sending is disabled.
create function public.demo_email_maintenance() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Privacy maintenance independent of sending enablement. Does not touch orders, payments or inventory.
 update public.demo_email_contacts set recipient_ciphertext=null where order_id in (select order_id from public.demo_email_contacts where recipient_ciphertext is not null and expires_at<=clock_timestamp() order by expires_at limit 100);
 update public.demo_email_outbox set request_ciphertext=null,request_hash=null,payload=null,state=case when provider_id is null then 'suppressed' else state end,
  next_attempt_at=null,next_poll_at=null,error_code='RETENTION' where id in (select id from public.demo_email_outbox where created_at<clock_timestamp()-interval '30 days' and payload is not null order by created_at limit 100);
 delete from public.demo_email_outbox where id in (select id from public.demo_email_outbox where created_at<clock_timestamp()-interval '90 days' order by created_at limit 100);
 delete from public.demo_email_contacts where order_id in (select c.order_id from public.demo_email_contacts c where c.expires_at<clock_timestamp()-interval '60 days' and not exists(select 1 from public.demo_email_outbox e where e.order_id=c.order_id) order by c.expires_at limit 100);
 delete from public.demo_email_budget where day<(clock_timestamp() at time zone 'UTC')::date-2;
end$$;
-- Fenced short leases; workers never hold a transaction across provider HTTP.
create function public.demo_email_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare sends jsonb; polls jsonb; work record;
begin
 perform public.demo_email_maintenance();
 if not (select enabled from public.demo_email_config where singleton) then return jsonb_build_object('sends','[]'::jsonb,'polls','[]'::jsonb); end if;
 -- Catch up only explicitly enrolled orders after a temporary sending pause. No legacy backfill.
 for work in select c.order_id,k.event from public.demo_email_contacts c join public.orders o on o.id=c.order_id
  cross join (values('payment_pending'),('payment_approved'),('order_cancelled'),('reservation_expired'),('payment_review')) k(event)
  where c.recipient_ciphertext is not null and c.expires_at>clock_timestamp()
  and public.demo_email_eligible(c.order_id,k.event)
  and not exists(select 1 from public.demo_email_outbox e where e.order_id=c.order_id and e.event=k.event)
  order by c.created_at,c.order_id,k.event limit 50 for key share of o skip locked loop
  perform public.demo_email_enqueue(work.order_id,work.event);
 end loop;

 update public.demo_email_outbox set state='review',error_code=case when first_attempt_at<=clock_timestamp()-interval '23 hours' then 'IDEMPOTENCY_WINDOW' else 'RETRY_EXHAUSTED' end,
  lease_id=null,lease_until=null,next_attempt_at=null,updated_at=clock_timestamp()
  where state in ('queued','sending') and provider_id is null and (lease_until is null or lease_until<=clock_timestamp())
  and (first_attempt_at<=clock_timestamp()-interval '23 hours' or send_attempts>=8 or claim_attempts>=32);
 update public.demo_email_outbox e set state='suppressed',next_attempt_at=null,error_code='RECIPIENT_BLOCKED',updated_at=clock_timestamp()
  from public.demo_email_contacts c where c.order_id=e.order_id and e.state='queued' and
  (c.recipient_ciphertext is null or exists(select 1 from public.demo_email_suppressions s where s.recipient_hash=c.recipient_hash));
 update public.demo_email_outbox e set state='suppressed',next_attempt_at=null,updated_at=clock_timestamp()
  where e.state='queued' and e.first_attempt_at is null and e.request_ciphertext is null and not public.demo_email_eligible(e.order_id,e.event);
 with picked as (select e.id from public.demo_email_outbox e join public.demo_email_contacts c on c.order_id=e.order_id
  where e.state in ('queued','sending') and e.next_attempt_at<=clock_timestamp() and e.send_attempts<8 and e.claim_attempts<32
  and c.recipient_ciphertext is not null and c.expires_at>clock_timestamp()
  and (e.lease_until is null or e.lease_until<=clock_timestamp())
  and not exists(select 1 from public.demo_email_outbox older where older.order_id=e.order_id and older.id<>e.id
   and (older.created_at,older.id)<(e.created_at,e.id) and older.state in ('queued','sending'))
  order by e.created_at,e.id limit 2 for update of e skip locked),
 claimed as (update public.demo_email_outbox e set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',claim_attempts=claim_attempts+1
  from picked where picked.id=e.id returning e.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'lease',e.lease_id,'event',e.event,'payload',e.payload,'first_attempt_at',e.first_attempt_at,
  'request_ciphertext',e.request_ciphertext,'request_hash',e.request_hash,'context_key',c.context_key,'recipient_ciphertext',c.recipient_ciphertext,'recipient_hash',c.recipient_hash)),'[]'::jsonb)
 into sends from claimed e join public.demo_email_contacts c on c.order_id=e.order_id;
 with picked as (select id from public.demo_email_outbox where state='accepted' and next_poll_at<=clock_timestamp() and poll_attempts<12
  and (lease_until is null or lease_until<=clock_timestamp()) order by next_poll_at,id limit 2 for update skip locked),
 claimed as (update public.demo_email_outbox e set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',poll_attempts=poll_attempts+1
  from picked where picked.id=e.id returning e.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'lease',e.lease_id,'provider_id',e.provider_id,'request_ciphertext',e.request_ciphertext,'request_hash',e.request_hash)),'[]'::jsonb)
 into polls from claimed e;
 return jsonb_build_object('sends',sends,'polls',polls);
end$$;
create function public.demo_email_freeze(p_id uuid,p_lease uuid,p_ciphertext text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.demo_email_outbox;
begin
 select * into e from public.demo_email_outbox where id=p_id and lease_id=p_lease and lease_until>clock_timestamp() and state='sending' for update;
 if not found then raise exception 'EMAIL_LEASE_LOST'; end if;
 if e.request_ciphertext is null then
  if p_ciphertext is null or length(p_ciphertext) not between 40 and 200000 or p_ciphertext !~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'
   or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_EMAIL'; end if;
  update public.demo_email_outbox set request_ciphertext=p_ciphertext,request_hash=p_hash where id=p_id returning * into e;
 end if;
 return jsonb_build_object('request_ciphertext',e.request_ciphertext,'request_hash',e.request_hash);
end$$;
create function public.demo_email_begin(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.demo_email_outbox; lim integer; used integer; d date;
begin
 select * into e from public.demo_email_outbox where id=p_id and lease_id=p_lease and lease_until>clock_timestamp() and state='sending' for update;
 if not found then return false; end if;
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
create function public.demo_email_result(p_id uuid,p_lease uuid,p_outcome text,p_provider uuid default null,p_delay integer default 60) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.demo_email_outbox;
begin
 if p_outcome is null or p_outcome not in ('accepted','NETWORK','TIMEOUT','HTTP_RETRY','PROVIDER_AUTH','PROVIDER_REJECTED','IDEMPOTENCY_CONFLICT','INVALID_RESPONSE','INVALID_DATA','RECIPIENT_BLOCKED','KEY_UNAVAILABLE')
 or p_delay is null or p_delay not between 1 and 86400 then raise exception 'INVALID_EMAIL'; end if;
 select * into e from public.demo_email_outbox where id=p_id and lease_id=p_lease and state='sending' for update;
 if not found then return false; end if;
 if p_outcome='accepted' then
  if p_provider is null then raise exception 'INVALID_EMAIL'; end if;
  update public.demo_email_outbox set state='accepted',provider_id=p_provider,accepted_at=clock_timestamp(),delivery='unknown',
   next_attempt_at=null,next_poll_at=clock_timestamp()+interval '1 minute',error_code=null,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 elsif p_outcome in ('NETWORK','TIMEOUT','HTTP_RETRY','INVALID_RESPONSE') then
  update public.demo_email_outbox set state=case when send_attempts>=8 then 'review' else 'queued' end,error_code=p_outcome,
   next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(p_delay,least(3600,30*(2^least(send_attempts,6))::integer))),
   lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 else
  update public.demo_email_outbox set state=case when p_outcome='RECIPIENT_BLOCKED' then 'suppressed' else 'failed' end,error_code=p_outcome,
   next_attempt_at=null,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 end if;
 return true;
end$$;
create function public.demo_email_delivery(p_id uuid,p_lease uuid,p_provider uuid,p_state text,p_delay integer default 300) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.demo_email_outbox; h text;
begin
 if p_delay is null or p_delay not between 1 and 86400 or p_state is null or p_state not in ('sent','delayed','delivered','bounced','complained','failed','suppressed','NETWORK','TIMEOUT','HTTP_RETRY','PROVIDER_AUTH','PROVIDER_REJECTED','INVALID_RESPONSE') then raise exception 'INVALID_EMAIL'; end if;
 select * into e from public.demo_email_outbox where id=p_id and lease_id=p_lease and state='accepted' and provider_id=p_provider for update;
 if not found then return false; end if;
 update public.demo_email_outbox set
  delivery=case when p_state in ('sent','delayed','delivered','bounced','complained','failed','suppressed') then p_state else delivery end,
  error_code=case when p_state in ('NETWORK','TIMEOUT','HTTP_RETRY','PROVIDER_AUTH','PROVIDER_REJECTED','INVALID_RESPONSE') then p_state
    when e.poll_attempts>=12 and p_state in ('sent','delayed') then 'DELIVERY_UNCONFIRMED' else null end,
  next_poll_at=case when p_state in ('delivered','bounced','complained','failed','suppressed') or poll_attempts>=12 then null else clock_timestamp()+make_interval(secs=>greatest(300,p_delay)) end,
  lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 if p_state in ('bounced','complained','suppressed') then
  select recipient_hash into h from public.demo_email_contacts where order_id=e.order_id;
  insert into public.demo_email_suppressions(recipient_hash,reason) values(h,p_state) on conflict(recipient_hash) do nothing;
 end if;
 return true;
end$$;
-- Private tables stay inaccessible even to service_role; only these narrow RPCs are granted.
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'demo_email_%' loop
 execute 'revoke all on function '||f||' from public,anon,authenticated,service_role';end loop;
end$$;
grant execute on function public.demo_email_create_order(uuid,text,jsonb,text,text),public.demo_email_maintenance(),public.demo_email_claim(),public.demo_email_freeze(uuid,uuid,text,text),
 public.demo_email_begin(uuid,uuid),public.demo_email_result(uuid,uuid,text,uuid,integer),public.demo_email_delivery(uuid,uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
