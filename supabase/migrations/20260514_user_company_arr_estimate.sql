-- Claude enrichment returns arr_estimate (short revenue band) for the seller profile.
ALTER TABLE public.user_company
  ADD COLUMN IF NOT EXISTS arr_estimate text;
