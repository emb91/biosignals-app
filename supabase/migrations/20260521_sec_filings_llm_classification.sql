-- Add LLM classification to sec_filings_local.
--
-- Powers the V2 funding monitor that routes 8-K Item 1.01 / 8.01 / 5.02
-- filings into specific signal flavours (licensing_deal, partnership_with_upfront_economics,
-- co_development_deal, milestone_payment, acquisition_distraction,
-- leadership_churn, restructuring) by reading the primary doc body via
-- Haiku 4.5. Also enriches 424B prospectus filings with proceeds + use-of-proceeds.
--
-- Cached per accession_number forever — filings don't change once posted.
-- Re-classification only happens if classification is null (initial sync)
-- or we add a `classification_version` migration to force a refresh.
--
-- Schema:
--   classification jsonb — full LLM output: { category, confidence, rationale,
--                          counterparty, upfront_usd, milestone_max_usd,
--                          deal_structure, therapy_area, person_name, role,
--                          change_type, offering_type, gross_proceeds_usd,
--                          price_per_share, shares_offered, use_of_proceeds_summary,
--                          key_facts: [string], effective_date }
--   classified_at timestamptz — when the LLM call ran (null = not yet classified)

alter table sec_filings_local
  add column if not exists classification jsonb,
  add column if not exists classified_at timestamptz;

-- Partial index for the "needs classification" queue — only 8-K and 424B
-- from tracked CIKs are candidates for classification, and most rows in
-- the mirror are Form D or non-tracked 8-Ks that never enter the queue.
create index if not exists sec_filings_local_needs_classification_idx
  on sec_filings_local (form_type, filing_date desc)
  where classification is null
    and (form_type like '8-K%' or form_type like '424B%');

-- GIN index on the category field for fast filtering ("show all licensing_deals")
-- via classification ->> 'category'.
create index if not exists sec_filings_local_classification_category_idx
  on sec_filings_local ((classification ->> 'category'))
  where classification is not null;
