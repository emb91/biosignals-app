-- Phase 2 of the contacts canonical split. Per-user layer. Reuses the EXISTING
-- contacts.id as user_contacts.id so every child-table FK (contact_readiness_snapshots,
-- contact_persona_scores, contact_attribution_snapshots, crm_contacts,
-- contact_emails/phones, signal_events) keeps pointing at the right row — no child
-- re-keying needed. user_overrides holds per-user manual edits (private; never
-- written to people). Applied to remote via Supabase MCP 2026-06-04.
CREATE TABLE public.user_contacts AS
SELECT
  c.id                       AS id,
  c.user_id,
  p.id                       AS person_id,
  c.company_id,
  c.source, c.batch_id, c.raw_upload_id,
  c.contact_fit_score, c.contact_fit_breakdown, c.contact_fit_coverage,
  c.contact_fit_scored_at, c.contact_fit_version,
  c.scored_against_persona_id,
  c.readiness_score, c.priority_score, c.crm_is_suppressed,
  c.contact_panel_summary, c.contact_fit_summary,
  c.fit_score, c.fit_score_reasoning, c.fit_score_matched_on, c.fit_score_gaps, c.overall_fit_score,
  c.archived_at, c.archived_by, c.archived_reason,
  '{}'::jsonb                AS user_overrides,
  c.created_at,
  c.updated_at
FROM public.contacts c
JOIN public.people p ON p.linkedin_url = c.linkedin_url
WHERE c.linkedin_url IS NOT NULL AND c.linkedin_url <> '';

ALTER TABLE public.user_contacts
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN person_id SET NOT NULL,
  ALTER COLUMN user_overrides SET DEFAULT '{}'::jsonb,
  ALTER COLUMN user_overrides SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.user_contacts ADD CONSTRAINT user_contacts_pkey PRIMARY KEY (id);
ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_person_id_fkey FOREIGN KEY (person_id)
  REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_user_person_key UNIQUE (user_id, person_id);

CREATE INDEX idx_user_contacts_user_id ON public.user_contacts (user_id);
CREATE INDEX idx_user_contacts_person_id ON public.user_contacts (person_id);
CREATE INDEX idx_user_contacts_company_id ON public.user_contacts (user_id, company_id);
CREATE INDEX idx_user_contacts_user_suppressed_priority
  ON public.user_contacts (user_id, crm_is_suppressed, priority_score DESC NULLS LAST);
