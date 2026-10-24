-- Incremental on evidence v2: created may have an explicitly unknown detail.
-- No default detail, no monetary inference, no table/data/grant changes.
begin;
do $$begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'OWNER_REQUIRED'; end if;
 if to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') is null or
    (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) is distinct from '653f90c499f70605fae984d0d3383ec3'
 then raise exception 'EVIDENCE_V2_RPC_REQUIRED'; end if;
end$$;
create or replace function public.mp_test_apply(p_id uuid,p_resource text,p_url text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments; stamp timestamptz; state text; detail text; paid bigint; unreported boolean; result text; target text;
begin
 select q.* into o from public.orders q join public.payments x on x.order_id=q.id where x.id=p_id and x.mp_test for update of q;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 select * into p from public.payments where id=p_id for update;
 if p_resource is null or p_resource !~ '^ORDTST[A-Z0-9]{10,60}$' or (p.mp_order_id is not null and p.mp_order_id<>p_resource)
 or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
 or (p_snapshot->>'reference') is distinct from o.public_reference::text
 or (p_snapshot->>'seller_id') is distinct from p.mp_seller_id or (p_snapshot->>'application_id') is distinct from p.mp_application_id
 or (p_snapshot->>'currency') is distinct from 'ARS' or (p_snapshot->>'amount_cents') is distinct from p.amount_cents::text
 or (p_snapshot->>'updated_at') is null
 or (p_snapshot->>'state') is null or (p_snapshot->>'detail') is null
 then raise exception 'INVALID_PAYMENT'; end if;
 if p_url is not null and p_url<>('https://www.mercadopago.com.ar/checkout/v1/redirect?order_id='||p_resource) then raise exception 'INVALID_PAYMENT'; end if;
 stamp:=(p_snapshot->>'updated_at')::timestamptz;
 state:=p_snapshot->>'state'; detail:=p_snapshot->>'detail';
 unreported:=coalesce(jsonb_typeof(p_snapshot->'paid_cents')='null' and p_snapshot->>'paid_evidence'='unreported',false);
 if unreported then
  if coalesce(p.mp_paid_amount_cents,0)>0 or p.status not in ('pending','rejected','cancelled','expired') or o.status not in ('pending','cancelled','expired')
   or p.mp_reconciliation not in ('unlinked','awaiting','closed')
   or (state='pending' and p.status not in ('pending','rejected'))
   or not coalesce((state='pending' and detail='pending' and
     ((p_snapshot->>'provider_state',p_snapshot->>'provider_detail') in (('created','created'),('processing','in_process'),('processing','pending_review_manual'))
      or (p_snapshot->>'provider_state'='created' and jsonb_typeof(p_snapshot->'provider_detail')='null')))
    or (state='cancelled' and detail='cancelled' and
     (p_snapshot->>'provider_state',p_snapshot->>'provider_detail') in (('canceled','expired'),('canceled','canceled'),('canceled','canceled_transaction'))),false)
  then raise exception 'INVALID_PAYMENT'; end if;
  paid:=null;
 else
  if (p_snapshot->>'paid_cents') is null or (p_snapshot->>'paid_cents') !~ '^[0-9]{1,12}$'
   or (p_snapshot ? 'paid_evidence' and (p_snapshot->>'paid_evidence') is distinct from 'reported')
  then raise exception 'INVALID_PAYMENT'; end if;
  paid:=(p_snapshot->>'paid_cents')::bigint;
  if state='approved' and (p_snapshot ? 'provider_state' or p_snapshot ? 'provider_detail') and
   ((p_snapshot->>'provider_state') is distinct from 'processed' or (p_snapshot->>'provider_detail') is distinct from 'accredited')
  then raise exception 'INVALID_PAYMENT'; end if;
 end if;
 if state not in ('pending','approved','rejected','cancelled','refunded','review') or detail not in ('accredited','pending','rejected','cancelled','refunded','partial','unknown')
 or stamp>clock_timestamp()+interval '5 minutes' or paid>p.amount_cents or (state='approved' and (paid is null or paid<>p.amount_cents or detail<>'accredited')) then raise exception 'INVALID_PAYMENT'; end if;
 -- Bind before state application; stale events cannot change a linked resource or URL.
 update public.payments set mp_order_id=p_resource,mp_checkout_url=coalesce(mp_checkout_url,p_url),mp_lease_until=null where id=p_id;
 if p.mp_updated_at is not null and stamp<p.mp_updated_at then return public.mp_test_context(p_id); end if;
 if (p.status in ('approved','refunded') and state in ('pending','rejected','cancelled')) or (p.status='refunded' and state='approved') then return public.mp_test_context(p_id); end if;
 result:=case when state='review' then 'review' when p.status='approved' and state='refunded' then 'review' else 'awaiting' end;
 target:=case when state='review' then p.status else state end;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
  perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id;
 end if;
 if state='approved' then
  if p.mp_reconciliation='settled' then result:='settled';
  elsif o.status='pending' then
   -- Guard sees proof in this same transaction, then primitive rechecks time AFTER inventory locks.
   update public.payments set status='approved',mp_reconciliation='settled' where id=p_id;
   perform public.demo_resolve_order(o.id,'confirmed'); select * into o from public.orders where id=o.id;
   result:=case when o.status='confirmed' then 'settled' else 'review' end;
  else result:='review'; end if;
 elsif state='cancelled' then
  if o.status='pending' then perform public.demo_resolve_order(o.id,'cancelled'); end if;
  result:='closed';
 elsif state='refunded' then result:='review';
 elsif o.status in ('expired','cancelled') then
  if state='pending' then result:='awaiting'; else result:='closed'; end if;
 end if;
 if o.status='expired' and state in ('pending','cancelled','rejected') then target:='expired'; end if;
 update public.payments set status=target,mp_provider_status=state,mp_provider_detail=detail,
 mp_paid_amount_cents=paid,mp_paid_evidence=case when unreported then 'unreported' else 'reported' end,
 mp_updated_at=stamp,mp_reconciliation=result,mp_next_check=clock_timestamp()+case when result in ('settled','closed','review') then interval '1 hour' else interval '1 minute' end
 where id=p_id;
 return public.mp_test_context(p_id);
end$$;
commit;
