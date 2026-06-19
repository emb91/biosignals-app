-- Generic DB-backed fixed-window rate limit (works across serverless instances,
-- which in-memory counters can't). Used to bound credit-spending public
-- endpoints like /api/auth/validate-email. Service-role only.
create table if not exists public.api_rate_limits (
  bucket text primary key,
  hits integer not null default 0,
  expires_at timestamptz not null
);
alter table public.api_rate_limits enable row level security;

-- Atomic "increment this window's counter and return the new value".
create or replace function public.api_rate_limit_hit(p_bucket text, p_expires timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into api_rate_limits (bucket, hits, expires_at)
  values (p_bucket, 1, p_expires)
  on conflict (bucket) do update set hits = api_rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits;
end
$$;

revoke execute on function public.api_rate_limit_hit(text, timestamptz) from public, anon, authenticated;
