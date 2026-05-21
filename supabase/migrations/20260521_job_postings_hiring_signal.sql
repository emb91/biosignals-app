-- Job postings local mirror — hiring signal.
--
-- Populated by the weekly /api/cron/jobs-delta cron, which calls the
-- Apify curious_coder/linkedin-jobs-scraper actor per tracked company and
-- upserts results here. The run-hiring-monitor then classifies titles and
-- emits cmc_hiring / clinical_ops_hiring / regulatory_hiring / bd_hiring /
-- commercial_hiring / job_surge signal events.
--
-- Dedup key: (company_id, linkedin_job_id) — stable across re-scrapes.
-- linkedin_job_id is extracted from the LinkedIn job detail URL.

-- ── Job postings mirror (one row per posting per company) ───────────────
create table if not exists job_postings_local (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  linkedin_job_id     text not null,               -- from LinkedIn job URL, e.g. "3987654321"
  title               text not null,
  title_normalized    text,                        -- lowercased, for keyword matching
  company_name        text,                        -- as returned by Apify (may differ from our record)
  location            text,
  posted_at           date,                        -- best-effort parse of Apify's postedAt field
  description_snippet text,                        -- first ~500 chars of description
  job_url             text,
  employment_type     text,                        -- full-time, contract, etc.
  seniority_level     text,
  scraped_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),

  unique (company_id, linkedin_job_id)
);

create index if not exists job_postings_local_company_id_idx
  on job_postings_local (company_id);
create index if not exists job_postings_local_scraped_at_idx
  on job_postings_local (scraped_at desc);
create index if not exists job_postings_local_posted_at_idx
  on job_postings_local (posted_at desc);

-- ── Sync run log ────────────────────────────────────────────────────────
create table if not exists job_postings_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null,                   -- running | success | failed
  companies_total int,
  companies_ok    int,
  companies_failed int,
  postings_upserted int,
  error           text
);
create index if not exists job_postings_sync_runs_started_idx
  on job_postings_sync_runs (started_at desc);

-- Admin-only; service role bypasses RLS.
alter table job_postings_local      enable row level security;
alter table job_postings_sync_runs  enable row level security;
