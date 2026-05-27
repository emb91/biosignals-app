-- SEC EDGAR funding write-back columns.
-- Populated by run-funding-monitor when a Form D filing is detected.
-- Intentionally separate from Apollo-sourced funding_stage / total_funding_usd
-- so SEC data never triggers ICP fit score recalculation.
-- Form D doesn't disclose round labels (Series A/B etc.) so funding_stage is
-- never written from SEC data — it stays Apollo-sourced.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sec_latest_funding_date      date,
  ADD COLUMN IF NOT EXISTS sec_latest_funding_amount    numeric,
  ADD COLUMN IF NOT EXISTS sec_latest_funding_accession text;

COMMENT ON COLUMN companies.sec_latest_funding_date      IS 'Date of most recent funding round detected via SEC EDGAR Form D (date_of_first_sale or filing_date). Updated by run-funding-monitor; never overwritten by Apollo enrichment.';
COMMENT ON COLUMN companies.sec_latest_funding_amount   IS 'Offering size (total_offering_amount) from the most recent Form D detected. Not a cumulative total.';
COMMENT ON COLUMN companies.sec_latest_funding_accession IS 'EDGAR accession number for the Form D filing that populated sec_latest_funding_date/amount. Used to deep-link to the source filing.';
