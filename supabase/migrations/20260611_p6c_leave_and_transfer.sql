-- Phase 6c: leave-team + ownership-transfer support.
--
-- reassign_member_data_to(p_from, p_to): when a member leaves, their contacts + accounts
-- (and direct children) move to the OWNER so the data stays with the org — the leaver
-- doesn't walk away with it. Conflict-safe: where the owner already holds the same person
-- / company, the owner's row is kept and the leaver's duplicate is dropped. Derived data
-- (readiness/attribution snapshots, CRM sync state) is deleted for the leaver — it
-- recomputes/re-syncs for the owner and isn't worth conflict-merging.

CREATE OR REPLACE FUNCTION public.reassign_member_data_to(p_from uuid, p_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RETURN; END IF;

  -- Outreach: repoint any sequence whose contact is a duplicate (owner already has that
  -- person) to the owner's contact for the same person, BEFORE we drop the duplicate.
  UPDATE public.outreach_sequences os
     SET contact_id = tgt.id
    FROM public.user_contacts dup
    JOIN public.user_contacts tgt ON tgt.user_id = p_to AND tgt.person_id = dup.person_id
   WHERE dup.user_id = p_from AND os.contact_id = dup.id;
  UPDATE public.outreach_sequences SET user_id = p_to WHERE user_id = p_from;

  -- Contact emails/phones follow the contact to the owner.
  UPDATE public.contact_emails SET user_id = p_to WHERE user_id = p_from;
  UPDATE public.contact_phones SET user_id = p_to WHERE user_id = p_from;

  -- Contacts: move the ones the owner doesn't already have; drop the duplicates.
  UPDATE public.user_contacts uc SET user_id = p_to
   WHERE uc.user_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.user_contacts t WHERE t.user_id = p_to AND t.person_id = uc.person_id);
  DELETE FROM public.user_contacts WHERE user_id = p_from;

  -- Accounts: same pattern on company_id.
  UPDATE public.user_companies ucp SET user_id = p_to
   WHERE ucp.user_id = p_from
     AND NOT EXISTS (SELECT 1 FROM public.user_companies t WHERE t.user_id = p_to AND t.company_id = ucp.company_id);
  DELETE FROM public.user_companies WHERE user_id = p_from;

  -- Derived / re-syncable state: drop the leaver's (recomputes or re-syncs for the owner).
  DELETE FROM public.contact_readiness_snapshots WHERE user_id = p_from;
  DELETE FROM public.account_readiness_snapshots WHERE user_id = p_from;
  DELETE FROM public.contact_attribution_snapshots WHERE user_id = p_from;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_member_data_to(uuid, uuid) FROM anon, authenticated;
