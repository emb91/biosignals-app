-- Phase 6b: editable contact details on the self-profile (phone, location, company).
-- These are user-editable overrides; the canonical/enriched values live on `people`.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS location     text,
  ADD COLUMN IF NOT EXISTS company_name text;
