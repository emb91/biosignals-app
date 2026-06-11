-- Phase 8 (multi-seat collision prevention): one active outreach per person per org.
--
-- Two reps in the same org must never both email the same prospect. The race-proof
-- primitive (same pattern as the data-purchase criteria-hash gate): stamp org_id +
-- person_id (canonical person) on outreach_sequences and enforce a PARTIAL UNIQUE index
-- over in-flight dispatch statuses. The dispatch route claims by flipping draft→'queued'
-- BEFORE calling the email provider — if a teammate already holds an in-flight sequence
-- for that person, the update violates the index (23505) and the send is rejected with a
-- friendly message. 'failed' is outside the index, so a failed send releases the claim.
--
-- person_id resolves via user_contacts (sequence.contact_id is the per-user contact row;
-- person_id is the canonical person shared across the org).

ALTER TABLE public.outreach_sequences
  ADD COLUMN IF NOT EXISTS org_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE SET NULL;

-- Backfill from membership + the contact link.
UPDATE public.outreach_sequences os
   SET org_id = m.org_id
  FROM public.org_members m
 WHERE m.user_id = os.user_id AND os.org_id IS NULL;

UPDATE public.outreach_sequences os
   SET person_id = uc.person_id
  FROM public.user_contacts uc
 WHERE uc.id = os.contact_id AND os.person_id IS NULL;

-- Auto-fill on insert/update so every new sequence carries both.
CREATE OR REPLACE FUNCTION public.set_outreach_sequence_org_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.org_members WHERE user_id = NEW.user_id;
  END IF;
  IF NEW.person_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT person_id INTO NEW.person_id FROM public.user_contacts WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outreach_sequences_set_org_person ON public.outreach_sequences;
CREATE TRIGGER outreach_sequences_set_org_person
  BEFORE INSERT OR UPDATE ON public.outreach_sequences
  FOR EACH ROW EXECUTE FUNCTION public.set_outreach_sequence_org_person();

-- The gate: at most ONE in-flight sequence per (org, person), org-wide.
-- Pre-checked: zero existing duplicate groups at migration time.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_sequences_org_person_inflight_idx
  ON public.outreach_sequences (org_id, person_id)
  WHERE org_id IS NOT NULL
    AND person_id IS NOT NULL
    AND dispatch_status IN ('queued', 'sent', 'replied');

-- Org-visible reads: teammates can SEE each other's sequences (status, who) so the UI can
-- say "In sequence with Alice" — read-only; writes stay per-user.
DROP POLICY IF EXISTS outreach_sequences_org_select ON public.outreach_sequences;
CREATE POLICY outreach_sequences_org_select ON public.outreach_sequences
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
