-- Visibility for silent classifier failures.
-- Before this change: a failed classification left `classification IS NULL`,
-- indistinguishable from "not yet attempted". Now we track attempts + the
-- error message so we can see what's broken.

alter table press_release_articles
  add column if not exists classification_error text,
  add column if not exists classification_attempts int not null default 0,
  add column if not exists last_classification_attempt_at timestamptz;

create index if not exists press_release_articles_failed_idx
  on press_release_articles (last_classification_attempt_at desc)
  where classification is null and classification_error is not null;

-- Same shape for sec_filings_local (the V2 classifier suffered the same bug).
alter table sec_filings_local
  add column if not exists classification_error text,
  add column if not exists classification_attempts int not null default 0,
  add column if not exists last_classification_attempt_at timestamptz;

create index if not exists sec_filings_local_classification_failed_idx
  on sec_filings_local (last_classification_attempt_at desc)
  where classification is null and classification_error is not null;
