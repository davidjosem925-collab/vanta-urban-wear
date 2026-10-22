-- Roll back phase 3 only. Preserve payment/order records; disable frontend flag first.
-- Deploy the previous demo-orders handler alongside rollback. No CASCADE or data deletion.
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
  'config',jsonb_build_object('online',jsonb_build_object('success_url',p_return_origin||'/#/checkout/finalizado',
   'failure_url',p_return_origin||'/#/checkout/revision','pending_url',p_return_origin||'/#/checkout/revision')));
 insert into public.payments(order_id,method,idempotency_key,amount_cents,mp_test,mp_request,mp_seller_id,mp_application_id,mp_reconciliation,mp_next_check,mp_cancel_key)
 values(o.id,'mercado_pago',gen_random_uuid(),o.subtotal_cents,true,body,c.seller_id,c.application_id,'unlinked',clock_timestamp(),gen_random_uuid()) returning * into p;
 return public.mp_test_context(p.id);
end$$;
drop function public.demo_transfer_payment(uuid,text);
commit;
