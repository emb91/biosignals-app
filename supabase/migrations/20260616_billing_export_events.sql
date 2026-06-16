-- Tracks daily export counts per org for the exports/day billing gate.
-- One row per (org, date); count is atomically incremented.

CREATE TABLE IF NOT EXISTS public.org_export_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL,
  export_date  date        NOT NULL DEFAULT CURRENT_DATE,
  export_count integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_export_events_org_date
  ON public.org_export_events (org_id, export_date);

CREATE INDEX IF NOT EXISTS org_export_events_org_id
  ON public.org_export_events (org_id);

-- RLS: service-role only (gate runs server-side).
ALTER TABLE public.org_export_events ENABLE ROW LEVEL SECURITY;

-- Atomic upsert: increment the count for today, return the new total.
-- Returns the updated count so callers can compare against the daily limit.
CREATE OR REPLACE FUNCTION public.increment_org_export_count(
  p_org_id   uuid,
  p_user_id  uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.org_export_events (org_id, user_id, export_date, export_count)
  VALUES (p_org_id, p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (org_id, export_date)
  DO UPDATE SET
    export_count = org_export_events.export_count + 1,
    updated_at   = now()
  RETURNING export_count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_org_export_count(uuid, uuid) FROM anon, authenticated;
