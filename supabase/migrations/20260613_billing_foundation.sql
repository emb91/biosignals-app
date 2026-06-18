-- Billing foundation (Phase 1 of strategy/pricing/pricing-model-codex-20260619/BILLING_PLAN.md)
--
-- The organization is the billable entity. Stripe is the source of truth for
-- subscription state; these tables are a synced cache plus our own meter:
--   - org_subscriptions: one row per org mirroring its Stripe subscription
--   - org_contact_packs: prepaid contact top-ups (one-time purchases)
--   - org_billable_contact_events: the contact meter. UNIQUE(org_id, person_id)
--     means a person can only ever be billed once per org — dedupe and
--     idempotency are enforced by the database, not application code.
--   - stripe_webhook_events: webhook idempotency ledger (at-least-once delivery)
--
-- All writes go through the service role (webhook handler / billing helpers);
-- org members get read-only RLS access for the Settings billing UI.

alter table public.organizations
  add column if not exists stripe_customer_id text unique;

-- ── Subscription state ──────────────────────────────────────────────────────

create table if not exists public.org_subscriptions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_subscription_id text unique,
  -- Mirrors Stripe subscription status: active | trialing | past_due | canceled | incomplete | unpaid
  status text not null default 'canceled',
  plan_key text not null,
  included_seats integer not null default 1,
  included_monthly_contacts integer not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Set on invoice.payment_failed; enforcement soft-locks after this passes.
  grace_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_subscriptions enable row level security;

drop policy if exists org_subscriptions_member_read on public.org_subscriptions;
create policy org_subscriptions_member_read on public.org_subscriptions
  for select using (org_id = public.user_org_id());

-- ── Prepaid contact packs ───────────────────────────────────────────────────

create table if not exists public.org_contact_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Idempotency key: checkout.session.completed can be delivered more than once.
  stripe_payment_intent_id text unique,
  contacts_purchased integer not null check (contacts_purchased > 0),
  contacts_remaining integer not null check (contacts_remaining >= 0),
  purchased_at timestamptz not null default now()
);

create index if not exists idx_org_contact_packs_org
  on public.org_contact_packs (org_id, purchased_at);

alter table public.org_contact_packs enable row level security;

drop policy if exists org_contact_packs_member_read on public.org_contact_packs;
create policy org_contact_packs_member_read on public.org_contact_packs
  for select using (org_id = public.user_org_id());

-- ── The contact meter ───────────────────────────────────────────────────────

create table if not exists public.org_billable_contact_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  -- Who triggered it (audit only; billing is org-level).
  user_id uuid references auth.users(id) on delete set null,
  user_contact_id uuid,
  source text not null check (source in ('import', 'acquisition', 'enrichment', 'backfill')),
  created_at timestamptz not null default now(),
  -- A person is billed at most once per org, ever. Refreshes are free.
  unique (org_id, person_id)
);

create index if not exists idx_org_billable_contact_events_org_period
  on public.org_billable_contact_events (org_id, created_at);

alter table public.org_billable_contact_events enable row level security;

drop policy if exists org_billable_contact_events_member_read on public.org_billable_contact_events;
create policy org_billable_contact_events_member_read on public.org_billable_contact_events
  for select using (org_id = public.user_org_id());

-- ── Webhook idempotency ledger ──────────────────────────────────────────────

create table if not exists public.stripe_webhook_events (
  id text primary key, -- Stripe event id (evt_…)
  type text not null,
  processed_at timestamptz not null default now()
);

-- Service-role only: RLS on, no policies.
alter table public.stripe_webhook_events enable row level security;
