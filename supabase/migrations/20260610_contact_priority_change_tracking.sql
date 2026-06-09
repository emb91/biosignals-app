-- Capture the previous priority_score whenever it changes, so /today can surface
-- "contacts whose priority rose recently" without a full score-history table.
-- Coexists with the existing set_row_updated_at BEFORE UPDATE trigger.

alter table public.contact_readiness_snapshots
  add column if not exists prev_priority_score numeric,
  add column if not exists priority_changed_at timestamptz;

create or replace function public.capture_contact_priority_change()
returns trigger
language plpgsql
as $$
begin
  -- Only record a change when the score actually moves (IS DISTINCT FROM handles nulls).
  if new.priority_score is distinct from old.priority_score then
    new.prev_priority_score := old.priority_score;
    new.priority_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists contact_readiness_snapshots_priority_change on public.contact_readiness_snapshots;
create trigger contact_readiness_snapshots_priority_change
  before update on public.contact_readiness_snapshots
  for each row
  execute function public.capture_contact_priority_change();
