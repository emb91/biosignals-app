-- Pre-launch hardening: give org invites a finite lifetime.
--
-- Previously a pending invite link never expired; the only guard was that the
-- accepting session's email had to match the invite. Add an explicit expiry so
-- a leaked link stops working after a week.
ALTER TABLE public.org_invites
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing rows from their creation time.
UPDATE public.org_invites
  SET expires_at = created_at + interval '7 days'
  WHERE expires_at IS NULL;
