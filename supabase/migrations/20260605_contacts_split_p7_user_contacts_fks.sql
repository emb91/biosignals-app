-- Phase 5 follow-up: user_contacts was created (Phase 2) with the company_id /
-- batch_id / raw_upload_id / scored_against_persona_id / archived_by / user_id
-- COLUMNS but WITHOUT their FK constraints. PostgREST derives a view's embeddable
-- relationships from the base tables' FKs, so without these, `contacts` (the view)
-- could not embed companies(...) / upload_batches(...) — the leads + accounts list
-- queries 400'd and rendered "no leads yet".
--
-- Re-add the 6 outbound FKs that contacts_legacy had, verbatim (ON DELETE behaviour
-- matched). Data verified orphan-free, so they validate immediately.

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.upload_batches(id) ON DELETE SET NULL;

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_raw_upload_id_fkey
    FOREIGN KEY (raw_upload_id) REFERENCES public.raw_uploads(id) ON DELETE SET NULL;

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_scored_against_persona_id_fkey
    FOREIGN KEY (scored_against_persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.user_contacts
  ADD CONSTRAINT user_contacts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
