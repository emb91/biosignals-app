-- Arcova workspace credits, usage caps, monitoring capacity and provider COGS.
-- Customer credits are deliberately independent from provider cost.

alter table public.org_subscriptions
  add column if not exists billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'annual')),
  add column if not exists stripe_price_id text;

alter table public.raw_uploads
  add column if not exists triage_group text
    check (triage_group is null or triage_group in ('high', 'medium', 'low')),
  add column if not exists triage_version text,
  add column if not exists triage_scored_at timestamptz;

alter table public.raw_uploads drop constraint if exists raw_uploads_status_check;
alter table public.raw_uploads add constraint raw_uploads_status_check check (
  status = any (array[
    'pending'::text, 'enriching'::text, 'awaiting_triage'::text,
    'awaiting_enrichment'::text, 'enriched'::text, 'duplicate'::text, 'failed'::text
  ])
);

create table if not exists public.org_credit_buckets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source text not null check (source in (
    'free_monthly', 'paid_monthly', 'annual', 'purchased', 'adjustment'
  )),
  credits_granted numeric(14,2) not null check (credits_granted >= 0),
  credits_remaining numeric(14,2) not null check (
    credits_remaining >= 0 and credits_remaining <= credits_granted
  ),
  valid_from timestamptz not null default now(),
  expires_at timestamptz not null,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, external_reference)
);

create index if not exists idx_org_credit_buckets_spend
  on public.org_credit_buckets (org_id, expires_at, created_at)
  where credits_remaining > 0;

create table if not exists public.org_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  status text not null default 'pending' check (
    status in ('pending', 'settled', 'refunded', 'partially_refunded')
  ),
  credits_requested numeric(14,2) not null check (credits_requested >= 0),
  credits_reserved numeric(14,2) not null check (credits_reserved >= 0),
  credits_settled numeric(14,2) not null default 0 check (credits_settled >= 0),
  entity_type text,
  entity_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (org_id, idempotency_key)
);

create index if not exists idx_org_credit_transactions_org_created
  on public.org_credit_transactions (org_id, created_at desc);

create table if not exists public.org_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.org_credit_transactions(id) on delete cascade,
  bucket_id uuid not null references public.org_credit_buckets(id) on delete restrict,
  credits_reserved numeric(14,2) not null check (credits_reserved > 0),
  credits_settled numeric(14,2) not null default 0 check (credits_settled >= 0),
  credits_refunded numeric(14,2) not null default 0 check (credits_refunded >= 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, bucket_id)
);

create table if not exists public.org_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  quantity numeric(14,2) not null check (quantity > 0),
  operation_key text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (org_id, action_type, operation_key)
);

create index if not exists idx_org_usage_events_window
  on public.org_usage_events (org_id, action_type, occurred_at);

create table if not exists public.org_monitored_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'active' check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  priority_score numeric,
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_provider_cost_usd numeric(14,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, person_id)
);

create index if not exists idx_org_monitored_contacts_due
  on public.org_monitored_contacts (next_sweep_at, org_id)
  where status = 'active';

create table if not exists public.org_monitored_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'active' check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  priority_score numeric,
  represented_by_active_contact boolean not null default false,
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_result_count integer,
  last_provider_cost_usd numeric(14,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, company_id)
);

create index if not exists idx_org_monitored_accounts_due
  on public.org_monitored_accounts (next_sweep_at, org_id)
  where status = 'active';

create table if not exists public.apify_run_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  actor_id text not null,
  action_type text not null,
  run_id text,
  input_count integer not null default 0,
  output_count integer not null default 0,
  attempted_count integer not null default 0,
  successful_count integer not null default 0,
  failed_count integer not null default 0,
  unit_price_usd numeric(14,8),
  actual_cost_usd numeric(14,6),
  customer_credit_transaction_id uuid
    references public.org_credit_transactions(id) on delete set null,
  included_monitoring boolean not null default false,
  price_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_apify_run_usage_org_created
  on public.apify_run_usage (org_id, created_at desc);

-- Fresh launch allocation for every existing workspace. Historical actions are
-- not charged retroactively. Future grants are invoice/calendar driven.
insert into public.org_credit_buckets (
  org_id, source, credits_granted, credits_remaining, valid_from,
  expires_at, external_reference, metadata
)
select
  o.id,
  case
    when s.status in ('active', 'trialing', 'past_due') and s.billing_interval = 'annual' then 'annual'
    when s.status in ('active', 'trialing', 'past_due') then 'paid_monthly'
    else 'free_monthly'
  end,
  case
    when s.status in ('active', 'trialing', 'past_due') and s.plan_key = 'growth'
      then case when s.billing_interval = 'annual' then 96000 else 8000 end
    when s.status in ('active', 'trialing', 'past_due') and s.plan_key = 'starter'
      then case when s.billing_interval = 'annual' then 24000 else 2000 end
    else 100
  end,
  case
    when s.status in ('active', 'trialing', 'past_due') and s.plan_key = 'growth'
      then case when s.billing_interval = 'annual' then 96000 else 8000 end
    when s.status in ('active', 'trialing', 'past_due') and s.plan_key = 'starter'
      then case when s.billing_interval = 'annual' then 24000 else 2000 end
    else 100
  end,
  case
    when s.status in ('active', 'trialing', 'past_due')
      then coalesce(s.current_period_start, now())
    else date_trunc('month', now())
  end,
  case
    when s.status in ('active', 'trialing', 'past_due')
      then coalesce(
        s.current_period_end,
        now() + case when s.billing_interval = 'annual' then interval '1 year' else interval '1 month' end
      )
    else date_trunc('month', now()) + interval '1 month'
  end,
  'migration:20260619:' || o.id::text,
  jsonb_build_object('migration', '20260619_arcova_workspace_credits')
from public.organizations o
left join public.org_subscriptions s on s.org_id = o.id
on conflict (org_id, external_reference) do nothing;

alter table public.org_credit_buckets enable row level security;
alter table public.org_credit_transactions enable row level security;
alter table public.org_credit_allocations enable row level security;
alter table public.org_usage_events enable row level security;
alter table public.org_monitored_contacts enable row level security;
alter table public.org_monitored_accounts enable row level security;
alter table public.apify_run_usage enable row level security;

drop policy if exists org_credit_buckets_member_read on public.org_credit_buckets;
create policy org_credit_buckets_member_read on public.org_credit_buckets
  for select using (org_id = public.user_org_id());

drop policy if exists org_credit_transactions_member_read on public.org_credit_transactions;
create policy org_credit_transactions_member_read on public.org_credit_transactions
  for select using (org_id = public.user_org_id());

drop policy if exists org_credit_allocations_member_read on public.org_credit_allocations;
create policy org_credit_allocations_member_read on public.org_credit_allocations
  for select using (
    exists (
      select 1 from public.org_credit_transactions t
      where t.id = transaction_id and t.org_id = public.user_org_id()
    )
  );

drop policy if exists org_usage_events_member_read on public.org_usage_events;
create policy org_usage_events_member_read on public.org_usage_events
  for select using (org_id = public.user_org_id());

drop policy if exists org_monitored_contacts_member_read on public.org_monitored_contacts;
create policy org_monitored_contacts_member_read on public.org_monitored_contacts
  for select using (org_id = public.user_org_id());

drop policy if exists org_monitored_accounts_member_read on public.org_monitored_accounts;
create policy org_monitored_accounts_member_read on public.org_monitored_accounts
  for select using (org_id = public.user_org_id());

create or replace function public.grant_org_credit_bucket(
  p_org_id uuid,
  p_source text,
  p_credits numeric,
  p_valid_from timestamptz,
  p_expires_at timestamptz,
  p_external_reference text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_credits < 0 or p_expires_at <= p_valid_from then
    raise exception 'invalid credit grant';
  end if;
  insert into public.org_credit_buckets (
    org_id, source, credits_granted, credits_remaining, valid_from,
    expires_at, external_reference, metadata
  ) values (
    p_org_id, p_source, p_credits, p_credits, p_valid_from,
    p_expires_at, p_external_reference, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (org_id, external_reference) do update
    set updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.reserve_org_credits(
  p_org_id uuid,
  p_user_id uuid,
  p_action_type text,
  p_credits numeric,
  p_idempotency_key text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_allowed_sources text[] default array[
    'free_monthly', 'paid_monthly', 'annual', 'purchased', 'adjustment'
  ],
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tx public.org_credit_transactions%rowtype;
  v_bucket record;
  v_available numeric(14,2);
  v_needed numeric(14,2);
  v_take numeric(14,2);
begin
  if p_credits < 0 then raise exception 'credits must be non-negative'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select * into v_tx from public.org_credit_transactions
  where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'transactionId', v_tx.id,
      'status', v_tx.status, 'reserved', v_tx.credits_reserved
    );
  end if;

  select coalesce(sum(credits_remaining), 0) into v_available
  from public.org_credit_buckets
  where org_id = p_org_id
    and source = any(p_allowed_sources)
    and valid_from <= now() and expires_at > now();

  if v_available < p_credits then
    return jsonb_build_object(
      'ok', false, 'code', 'insufficient_credits',
      'requiredCredits', p_credits, 'availableCredits', v_available
    );
  end if;

  insert into public.org_credit_transactions (
    org_id, user_id, action_type, credits_requested, credits_reserved,
    entity_type, entity_id, idempotency_key, metadata
  ) values (
    p_org_id, p_user_id, p_action_type, p_credits, p_credits,
    p_entity_type, p_entity_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_tx;

  v_needed := p_credits;
  for v_bucket in
    select id, credits_remaining from public.org_credit_buckets
    where org_id = p_org_id
      and source = any(p_allowed_sources)
      and credits_remaining > 0
      and valid_from <= now() and expires_at > now()
    order by expires_at asc, created_at asc
    for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed, v_bucket.credits_remaining);
    update public.org_credit_buckets
      set credits_remaining = credits_remaining - v_take, updated_at = now()
      where id = v_bucket.id;
    insert into public.org_credit_allocations (
      transaction_id, bucket_id, credits_reserved
    ) values (v_tx.id, v_bucket.id, v_take);
    v_needed := v_needed - v_take;
  end loop;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'transactionId', v_tx.id,
    'status', v_tx.status, 'reserved', v_tx.credits_reserved
  );
end;
$$;

create or replace function public.settle_org_credits(
  p_transaction_id uuid,
  p_credits numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tx public.org_credit_transactions%rowtype;
  v_allocation record;
  v_refund numeric(14,2);
  v_piece numeric(14,2);
begin
  select * into v_tx from public.org_credit_transactions
    where id = p_transaction_id for update;
  if not found then raise exception 'credit transaction not found'; end if;
  if v_tx.status <> 'pending' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'status', v_tx.status,
      'settled', v_tx.credits_settled
    );
  end if;
  if p_credits < 0 or p_credits > v_tx.credits_reserved then
    raise exception 'settled credits exceed reservation';
  end if;

  v_refund := v_tx.credits_reserved - p_credits;
  for v_allocation in
    select a.*, b.expires_at
    from public.org_credit_allocations a
    join public.org_credit_buckets b on b.id = a.bucket_id
    where a.transaction_id = p_transaction_id
    order by b.expires_at desc, a.created_at desc
    for update of a
  loop
    v_piece := least(v_refund, v_allocation.credits_reserved);
    if v_piece > 0 then
      update public.org_credit_buckets
        set credits_remaining = credits_remaining + v_piece, updated_at = now()
        where id = v_allocation.bucket_id;
    end if;
    update public.org_credit_allocations set
      credits_refunded = v_piece,
      credits_settled = credits_reserved - v_piece
    where id = v_allocation.id;
    v_refund := v_refund - v_piece;
  end loop;

  update public.org_credit_transactions set
    credits_settled = p_credits,
    status = case
      when p_credits = 0 then 'refunded'
      when p_credits < credits_reserved then 'partially_refunded'
      else 'settled'
    end,
    settled_at = now()
  where id = p_transaction_id
  returning * into v_tx;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'status', v_tx.status,
    'settled', v_tx.credits_settled
  );
end;
$$;

create or replace function public.refund_org_credits(
  p_transaction_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public.settle_org_credits(p_transaction_id, 0);
end;
$$;

create or replace function public.check_and_increment_usage(
  p_org_id uuid,
  p_user_id uuid,
  p_action_type text,
  p_quantity numeric,
  p_operation_key text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_limit numeric,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_used numeric(14,2);
  v_existing public.org_usage_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_action_type, 0));
  select * into v_existing from public.org_usage_events
    where org_id = p_org_id and action_type = p_action_type
      and operation_key = p_operation_key;
  if found then
    select coalesce(sum(quantity), 0) into v_used
    from public.org_usage_events
    where org_id = p_org_id and action_type = p_action_type
      and occurred_at >= p_window_start and occurred_at < p_window_end;
    return jsonb_build_object('ok', true, 'idempotent', true, 'used', v_used, 'limit', p_limit);
  end if;

  select coalesce(sum(quantity), 0) into v_used
  from public.org_usage_events
  where org_id = p_org_id and action_type = p_action_type
    and occurred_at >= p_window_start and occurred_at < p_window_end;

  if v_used + p_quantity > p_limit then
    return jsonb_build_object(
      'ok', false, 'code', 'usage_cap_reached', 'used', v_used,
      'limit', p_limit, 'resetsAt', p_window_end
    );
  end if;

  insert into public.org_usage_events (
    org_id, user_id, action_type, quantity, operation_key, metadata
  ) values (
    p_org_id, p_user_id, p_action_type, p_quantity, p_operation_key,
    coalesce(p_metadata, '{}'::jsonb)
  );
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'used', v_used + p_quantity,
    'limit', p_limit, 'resetsAt', p_window_end
  );
end;
$$;

revoke all on function public.grant_org_credit_bucket(
  uuid, text, numeric, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.reserve_org_credits(
  uuid, uuid, text, numeric, text, text, text, text[], jsonb
) from public, anon, authenticated;
revoke all on function public.settle_org_credits(uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.refund_org_credits(uuid)
  from public, anon, authenticated;
revoke all on function public.check_and_increment_usage(
  uuid, uuid, text, numeric, text, timestamptz, timestamptz, numeric, jsonb
) from public, anon, authenticated;

grant execute on function public.grant_org_credit_bucket(
  uuid, text, numeric, timestamptz, timestamptz, text, jsonb
) to service_role;
grant execute on function public.reserve_org_credits(
  uuid, uuid, text, numeric, text, text, text, text[], jsonb
) to service_role;
grant execute on function public.settle_org_credits(uuid, numeric)
  to service_role;
grant execute on function public.refund_org_credits(uuid)
  to service_role;
grant execute on function public.check_and_increment_usage(
  uuid, uuid, text, numeric, text, timestamptz, timestamptz, numeric, jsonb
) to service_role;
