-- Add buyer_prerequisites and buyer_disqualifiers to user_company.
-- These fields capture what a buyer must already have in place for the seller's
-- product to deliver value (prerequisites) and conditions that rule a buyer out
-- regardless of firmographic fit (disqualifiers). Both are inferred during the
-- My Company enrichment step and surfaced explicitly to the ICP agent.
alter table public.user_company
  add column if not exists buyer_prerequisites text[],
  add column if not exists buyer_disqualifiers text[];
