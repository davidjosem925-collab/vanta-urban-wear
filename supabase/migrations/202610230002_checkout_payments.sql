-- Stage 8 phase 3. Incremental: no historical rows or frozen provider requests are rewritten.
begin;
create or replace function public.mp_test_prepare(p_reference uuid,p_owner text,p_create boolean,p_return_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments; c public.mp_test_config; body jsonb;
begin
 if p_owner is null or p_owner !~ '^[a-f0-9]{64}$' or p_create is null then raise exception 'INVALID_REQUEST'; end if;
 select * into o from public.orders where public_reference=p_reference and is_demo and owner_hash=p_owner and demo_payment='mercado_pago' for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
  perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id;
 end if;
 select * into p from public.payments where order_id=o.id and mp_test;
 if found then return public.mp_test_context(p.id); end if;
 if not p_create then return null; end if;
 select * into c from public.mp_test_config where singleton;
 if not c.enabled then raise exception 'PAYMENTS_DISABLED'; end if;
 if o.status<>'pending' then raise exception 'ORDER_UNAVAILABLE'; end if;
 if exists(select 1 from public.payments where order_id=o.id) then raise exception 'PAYMENT_CONFLICT'; end if;
 if p_return_origin is null or length(p_return_origin)>300 or p_return_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'INVALID_REQUEST'; end if;
 body:=jsonb_build_object('type','online','processing_mode','manual','capture_mode','automatic_async',
  'total_amount',(o.subtotal_cents/100)::text||'.'||lpad((o.subtotal_cents%100)::text,2,'0'),
  'external_reference',o.public_reference::text,'expiration_time','PT1H',
  'items',(select jsonb_agg(jsonb_build_object('title',i.product_name||' / '||i.size||' / '||i.color,
   'quantity',i.quantity,'unit_price',(i.unit_price_cents/100)::text||'.'||lpad((i.unit_price_cents%100)::text,2,'0')) order by i.variant_id)
   from public.order_items i where order_id=o.id),
  'config',jsonb_build_object('online',jsonb_build_object('success_url',p_return_origin||'/#/checkout/pago',
   'failure_url',p_return_origin||'/#/checkout/pago','pending_url',p_return_origin||'/#/checkout/pago')));
 insert into public.payments(order_id,method,idempotency_key,amount_cents,mp_test,mp_request,mp_seller_id,mp_application_id,mp_reconciliation,mp_next_check,mp_cancel_key)
 values(o.id,'mercado_pago',gen_random_uuid(),o.subtotal_cents,true,body,c.seller_id,c.application_id,'unlinked',clock_timestamp(),gen_random_uuid()) returning * into p;
 return public.mp_test_context(p.id);
end$$;
-- Called only by the Edge service after its existing origin/rate checks.
-- One transaction locks the order; no extra reservations and no browser settlement.
create function public.demo_transfer_payment(p_reference uuid,p_owner text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; p public.payments;
begin
 if p_owner is null or p_owner !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST'; end if;
 select * into o from public.orders where public_reference=p_reference and is_demo
  and demo_payment='transfer' and owner_hash=p_owner for update;
 if not found then raise exception 'ORDER_UNAVAILABLE'; end if;
 if o.status='pending' and o.reservation_expires_at<=clock_timestamp() then
  perform public.demo_resolve_order(o.id,'expired'); select * into o from public.orders where id=o.id;
 end if;
 select * into p from public.payments where order_id=o.id order by created_at,id limit 1;
 if not found then
  insert into public.payments(order_id,method,idempotency_key,amount_cents,status)
  values(o.id,'bank_transfer',gen_random_uuid(),o.subtotal_cents,
   case when o.status in ('expired','cancelled') then o.status else 'pending' end) returning * into p;
 end if;
 if p.method<>'bank_transfer' or p.mp_test then raise exception 'PAYMENT_CONFLICT'; end if;
 -- Reflect expiry/cancellation for an unpaid transfer without overwriting financial evidence.
 if p.status='pending' and o.status in ('expired','cancelled') then
  update public.payments set status=o.status,updated_at=clock_timestamp() where id=p.id returning * into p;
 end if;
 return jsonb_build_object('reference',o.public_reference,'order_status',o.status,
  'payment_status',p.status,'reconciliation',case when p.status='approved' then 'settled' else 'awaiting' end,
  'amount_cents',p.amount_cents,'currency',p.currency,'expires_at',o.reservation_expires_at,
  'checkout_url',null,'demo',true);
end$$;
revoke all on function public.demo_transfer_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.demo_transfer_payment(uuid,text) to service_role;

commit;
