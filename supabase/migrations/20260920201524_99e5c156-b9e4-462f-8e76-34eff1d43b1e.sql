create or replace function public.ringfuel_breakdown(
  p_client_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table(
  dimension text,
  key text,
  calls bigint,
  connected bigint,
  converted bigint,
  revenue_known bigint,
  revenue numeric,
  duration_seconds numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      c.connected,
      c.converted,
      c.revenue_captured,
      coalesce(c.revenue, 0) as revenue,
      coalesce(nullif(c.connection_duration_seconds, 0), c.duration_seconds, 0) as dur,
      coalesce(nullif(c.did, ''), 'Unattributed') as did_key,
      coalesce(nullif(c.campaign_name, ''), 'Unattributed') as campaign_key,
      coalesce(
        nullif(c.raw_payload->>'Publisher', ''),
        nullif(c.raw_payload->>'publisher_name', ''),
        nullif(c.raw_payload->>'publisher', ''),
        'Unattributed'
      ) as publisher_key
    from public.ringfuel_calls c
    where c.client_id = p_client_id
      and coalesce(c.is_test, false) = false
      and c.call_start >= p_start
      and c.call_start <= p_end
  ), unrolled as (
    select 'did'::text as dimension, did_key as key, * from base
    union all
    select 'campaign'::text, campaign_key, * from base
    union all
    select 'publisher'::text, publisher_key, * from base
  )
  select
    dimension,
    key,
    count(*)::bigint,
    count(*) filter (where connected is true)::bigint,
    count(*) filter (where converted is true and revenue_captured is true)::bigint,
    count(*) filter (where revenue_captured is true)::bigint,
    sum(case when revenue_captured is true then revenue else 0 end)::numeric,
    sum(dur)::numeric
  from unrolled
  group by dimension, key;
$$;

revoke all on function public.ringfuel_breakdown(uuid, timestamptz, timestamptz) from public;
grant execute on function public.ringfuel_breakdown(uuid, timestamptz, timestamptz) to authenticated, service_role;