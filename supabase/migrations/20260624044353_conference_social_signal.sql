-- Conference social-intent signal (Phase 3, attending_conference, contact-level).
-- Applied 2026-06-24 via the Supabase MCP; recorded here for version control.
-- LinkedIn-only, windowed hashtag sweep into a shared attendees mirror.

create extension if not exists pg_trgm;

alter table conferences add column if not exists social_tags text[] not null default '{}';

create table if not exists conference_social_attendees_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,
  author_name_raw text not null,
  author_name_token text,
  author_profile_url text,
  author_headline text,
  author_company_raw text,
  post_url text,
  post_text text,
  posted_at timestamptz,
  matched_tags text[],
  network text not null default 'linkedin',
  assertion_cue text,
  confidence numeric,
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,
  unique (conference_id, author_name_token)
);
create index if not exists conf_social_attendees_token_idx on conference_social_attendees_local (author_name_token);
create index if not exists conf_social_attendees_token_trgm_idx on conference_social_attendees_local using gin (author_name_token gin_trgm_ops);
create index if not exists conf_social_attendees_company_ids_idx on conference_social_attendees_local using gin (mentioned_company_ids);
create index if not exists conf_social_attendees_conf_idx on conference_social_attendees_local (conference_id);

create table if not exists conference_social_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  conferences_polled int,
  attendees_upserted int,
  error text
);
create index if not exists conf_social_sync_runs_started_idx on conference_social_sync_runs (started_at desc);

alter table conference_social_attendees_local enable row level security;
alter table conference_social_sync_runs enable row level security;
