-- Exact historical candidate only: NOT a claim that the remote body matches. Never apply remotely.
create function public.demo_rate_limit(p_actor text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text; n integer; allowed boolean := true; t timestamptz := clock_timestamp();
begin
 if p_actor is null or p_actor !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach k in array array['actor:' || p_actor, 'global'] loop
   insert into public.demo_request_limits(bucket,window_start,attempts) values(k,t,1)
   on conflict(bucket) do update set
     attempts = case when demo_request_limits.window_start <= t - interval '1 hour' then 1 else least(demo_request_limits.attempts+1,1000000) end,
     window_start = case when demo_request_limits.window_start <= t - interval '1 hour' then t else demo_request_limits.window_start end
   returning attempts into n;
   if n > 6 then allowed := false; end if;
 end loop;
 return allowed;
end $$;
