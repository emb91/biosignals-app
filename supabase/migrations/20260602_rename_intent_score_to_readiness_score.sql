-- Intent was the v1 signal-strength score; readiness (the 5-dimension snapshot
-- model) superseded it. Rename the columns so the vocabulary matches reality.
-- Postgres views track columns by attnum, so accounts_view follows the rename
-- without a recreate (its frozen output name is fixed separately in the
-- companion migration). readiness_score becomes a denormalized mirror of the
-- readiness snapshot overall_score (written by the readiness cron going
-- forward); backfill now from existing snapshots so it's correct immediately.

ALTER TABLE contacts RENAME COLUMN intent_score TO readiness_score;
ALTER TABLE user_companies RENAME COLUMN intent_score TO readiness_score;

UPDATE contacts c
SET readiness_score = s.overall_score
FROM contact_readiness_snapshots s
WHERE s.contact_id = c.id AND s.user_id = c.user_id;

UPDATE contacts c
SET readiness_score = NULL
WHERE c.readiness_score IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM contact_readiness_snapshots s
    WHERE s.contact_id = c.id AND s.user_id = c.user_id
  );

UPDATE user_companies uc
SET readiness_score = s.overall_score
FROM account_readiness_snapshots s
WHERE s.company_id = uc.company_id AND s.user_id = uc.user_id;

UPDATE user_companies uc
SET readiness_score = NULL
WHERE uc.readiness_score IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM account_readiness_snapshots s
    WHERE s.company_id = uc.company_id AND s.user_id = uc.user_id
  );
