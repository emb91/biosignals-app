-- Phase 5: the flip.
--   1. Repoint all 11 child FKs from contacts(id) -> user_contacts(id).
--      ids match 1:1 (Phase 2 reused contacts.id as user_contacts.id), so this
--      is a metadata change that existing data already satisfies. After this,
--      new contacts created via the view (new user_contacts ids) validate.
--   2. Rename contacts -> contacts_legacy, contacts_compat -> contacts so every
--      `.from('contacts')` read/write transparently hits the canonical-split
--      view + its INSTEAD OF triggers. Reversible by renaming back.
--   3. Reload the PostgREST schema cache.
--
-- contacts_legacy is RETAINED (Phase 7, dropping it, is intentionally deferred)
-- as the rollback target.

-- 1. child FK repoint -------------------------------------------------------
-- ON DELETE CASCADE group
ALTER TABLE public.contact_attribution_snapshots DROP CONSTRAINT contact_attribution_snapshots_contact_id_fkey;
ALTER TABLE public.contact_attribution_snapshots ADD CONSTRAINT contact_attribution_snapshots_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.contact_emails DROP CONSTRAINT contact_emails_contact_id_fkey;
ALTER TABLE public.contact_emails ADD CONSTRAINT contact_emails_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.contact_persona_scores DROP CONSTRAINT contact_persona_scores_contact_id_fkey;
ALTER TABLE public.contact_persona_scores ADD CONSTRAINT contact_persona_scores_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.contact_phones DROP CONSTRAINT contact_phones_contact_id_fkey;
ALTER TABLE public.contact_phones ADD CONSTRAINT contact_phones_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.contact_readiness_snapshots DROP CONSTRAINT contact_readiness_snapshots_contact_id_fkey;
ALTER TABLE public.contact_readiness_snapshots ADD CONSTRAINT contact_readiness_snapshots_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.normalized_signals DROP CONSTRAINT normalized_signals_contact_id_fkey;
ALTER TABLE public.normalized_signals ADD CONSTRAINT normalized_signals_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.outreach_sequences DROP CONSTRAINT outreach_sequences_contact_id_fkey;
ALTER TABLE public.outreach_sequences ADD CONSTRAINT outreach_sequences_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.signal_source_events DROP CONSTRAINT signal_source_events_entity_contact_id_fkey;
ALTER TABLE public.signal_source_events ADD CONSTRAINT signal_source_events_entity_contact_id_fkey
  FOREIGN KEY (entity_contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.signals DROP CONSTRAINT signals_contact_id_fkey;
ALTER TABLE public.signals ADD CONSTRAINT signals_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.user_contacts(id) ON DELETE CASCADE;

-- ON DELETE SET NULL group
ALTER TABLE public.crm_contacts DROP CONSTRAINT crm_contacts_arcova_contact_id_fkey;
ALTER TABLE public.crm_contacts ADD CONSTRAINT crm_contacts_arcova_contact_id_fkey
  FOREIGN KEY (arcova_contact_id) REFERENCES public.user_contacts(id) ON DELETE SET NULL;

ALTER TABLE public.crm_deal_contact_links DROP CONSTRAINT crm_deal_contact_links_arcova_contact_id_fkey;
ALTER TABLE public.crm_deal_contact_links ADD CONSTRAINT crm_deal_contact_links_arcova_contact_id_fkey
  FOREIGN KEY (arcova_contact_id) REFERENCES public.user_contacts(id) ON DELETE SET NULL;

-- 2. the rename flip --------------------------------------------------------
ALTER TABLE public.contacts RENAME TO contacts_legacy;
ALTER VIEW public.contacts_compat RENAME TO contacts;

-- 3. reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
