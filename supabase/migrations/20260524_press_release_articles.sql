-- Press release ingestion mirror — biotech/pharma news pillar.
--
-- Pulls RSS feeds from GlobeNewswire (Health, Pharmaceuticals) and PRNewswire
-- (health-latest-news, biotech-latest-news), dedupes by canonical article URL,
-- and Haiku-classifies each article into a signal category.
--
-- Categories emitted (single shared classification jsonb shape):
--   conference_presentation, licensing_deal, partnership_with_upfront_economics,
--   co_development_deal, partnership_deal, milestone_payment, leadership_churn,
--   layoffs, new_facility, facility_expansion, restructuring, m_and_a (buyer),
--   m_and_a_target (seller), commercialization_move, fda_approval, phase_transition,
--   funding_round, grant_award, ipo_or_follow_on, other (no emit).
--
-- The per-user monitor matches `candidate_companies_normalized` against the
-- user's companies+aliases and emits the appropriate signal flavour.

create extension if not exists pg_trgm;

create table if not exists press_release_articles (
  id uuid primary key default gen_random_uuid(),
  source text not null,                       -- 'globenewswire' | 'prnewswire' | 'businesswire'
  source_feed text,                           -- specific feed slug we pulled it from
  source_url text not null,                   -- canonical article URL — dedupe key
  source_guid text,                           -- RSS guid (sometimes != source_url)
  title text not null,
  summary text,                               -- RSS description (HTML stripped)
  body_text text,                             -- optional full body if fetched
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),

  -- LLM output. category drives signal emission; rationale is the sales-facing summary.
  classification jsonb,
  classified_at timestamptz,

  -- Company names the LLM identified in the release. Normalized form is what
  -- the monitor matches against companies.aliases via trgm.
  candidate_companies text[],
  candidate_companies_normalized text[],

  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint press_release_articles_url_unique unique (source_url)
);

create index if not exists press_release_articles_published_idx
  on press_release_articles (published_at desc);
create index if not exists press_release_articles_source_idx
  on press_release_articles (source);
create index if not exists press_release_articles_category_idx
  on press_release_articles ((classification ->> 'category'))
  where classification is not null;
create index if not exists press_release_articles_companies_gin_idx
  on press_release_articles using gin (candidate_companies_normalized);
create index if not exists press_release_articles_needs_classify_idx
  on press_release_articles (published_at desc)
  where classification is null;

create table if not exists press_release_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                       -- running | success | failed
  articles_upserted int,
  articles_classified int,
  feeds_fetched int,
  feeds_failed int,
  cutoff_date timestamptz,                    -- earliest published_at considered
  error text
);
create index if not exists press_release_sync_runs_started_idx
  on press_release_sync_runs (started_at desc);

-- Admin-only tables; service role bypasses RLS.
alter table press_release_articles enable row level security;
alter table press_release_sync_runs enable row level security;
