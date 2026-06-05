-- Add an opt-in call-to-action link to per-user outreach settings.
--
-- Surfaced as a per-message checkbox in the /outreach editor ("add: {label}
-- {url}"). NOT injected into generated copy automatically — the rep opts in
-- per step. cta_label is the lead-in phrasing (e.g. "Book a call with me"),
-- cta_url is where it points (Calendly, a personal page, the company site, …).

ALTER TABLE user_outreach_settings
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS cta_label text;
