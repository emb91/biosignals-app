-- Local mirrors for FDA (drugs + devices) and ClinicalTrials.gov data,
-- populated by daily/weekly crons that pull from each respective official API.
-- User-triggered monitors join against these tables instead of querying the
-- live APIs per-company — Tier 2 architecture, same as patent_events.

create extension if not exists pg_trgm;

-- ── FDA drugsFDA (drug applications + nested submissions) ───────────────
create table if not exists fda_drug_submissions (
  application_number text not null,
  submission_number text not null,
  sponsor_name text,
  sponsor_normalized text,
  product_brand_name text,
  submission_status text,
  submission_status_date date,
  submission_type text,
  submission_class_code text,
  submission_class_code_description text,
  review_priority text,
  submission_property_type jsonb,
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (application_number, submission_number)
);
create index if not exists fda_drug_submissions_sponsor_norm_idx
  on fda_drug_submissions (sponsor_normalized);
create index if not exists fda_drug_submissions_sponsor_trgm_idx
  on fda_drug_submissions using gin (sponsor_normalized gin_trgm_ops);
create index if not exists fda_drug_submissions_status_date_idx
  on fda_drug_submissions (submission_status_date desc);

-- ── FDA 510(k) device clearances ────────────────────────────────────────
create table if not exists fda_device_510k (
  k_number text primary key,
  applicant text,
  applicant_normalized text,
  device_name text,
  product_code text,
  decision_code text,
  decision_description text,
  decision_date date,
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists fda_device_510k_applicant_norm_idx
  on fda_device_510k (applicant_normalized);
create index if not exists fda_device_510k_applicant_trgm_idx
  on fda_device_510k using gin (applicant_normalized gin_trgm_ops);
create index if not exists fda_device_510k_decision_date_idx
  on fda_device_510k (decision_date desc);

-- ── FDA PMA device approvals (original + supplements) ───────────────────
create table if not exists fda_device_pma (
  pma_number text not null,
  supplement_number text not null default '',
  applicant text,
  applicant_normalized text,
  trade_name text,
  generic_name text,
  supplement_type text,
  supplement_reason text,
  decision_code text,
  decision_date date,
  advisory_committee_description text,
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (pma_number, supplement_number)
);
create index if not exists fda_device_pma_applicant_norm_idx
  on fda_device_pma (applicant_normalized);
create index if not exists fda_device_pma_applicant_trgm_idx
  on fda_device_pma using gin (applicant_normalized gin_trgm_ops);
create index if not exists fda_device_pma_decision_date_idx
  on fda_device_pma (decision_date desc);

-- ── Sync run log for FDA delta ──────────────────────────────────────────
create table if not exists fda_delta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  cutoff_date date not null,
  drug_submissions_upserted int,
  device_510k_upserted int,
  device_pma_upserted int,
  error text
);
create index if not exists fda_delta_sync_runs_started_idx
  on fda_delta_sync_runs (started_at desc);

-- ── Clinical trials (one row per study) ─────────────────────────────────
create table if not exists clinical_trials (
  nct_id text primary key,
  brief_title text,
  overall_status text,
  phases text[] not null default '{}',
  conditions text[] not null default '{}',
  lead_sponsor text,
  lead_sponsor_normalized text,
  collaborators text[] not null default '{}',
  collaborators_normalized text[] not null default '{}',
  locations_count int,
  last_update_post_date date,
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists clinical_trials_lead_sponsor_norm_idx
  on clinical_trials (lead_sponsor_normalized);
create index if not exists clinical_trials_lead_sponsor_trgm_idx
  on clinical_trials using gin (lead_sponsor_normalized gin_trgm_ops);
create index if not exists clinical_trials_collaborators_norm_idx
  on clinical_trials using gin (collaborators_normalized);
create index if not exists clinical_trials_last_update_idx
  on clinical_trials (last_update_post_date desc);

create table if not exists ct_delta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  cutoff_date date not null,
  trials_upserted int,
  error text
);
create index if not exists ct_delta_sync_runs_started_idx
  on ct_delta_sync_runs (started_at desc);

alter table fda_drug_submissions enable row level security;
alter table fda_device_510k enable row level security;
alter table fda_device_pma enable row level security;
alter table fda_delta_sync_runs enable row level security;
alter table clinical_trials enable row level security;
alter table ct_delta_sync_runs enable row level security;
