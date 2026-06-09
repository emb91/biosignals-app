-- Mirror of 20260610_contact_priority_change_tracking, for account priority changes.
-- Captures the previous priority_score on account_readiness_snapshots whenever it
-- moves, so /today can flag accounts whose priority changed. Coexists with the
-- existing set_row_updated_at BEFORE UPDATE trigger.

alter table public.account_readiness_snapshots
  add column if not exists prev_priority_score numeric,
  add column if not exists priority_changed_at timestamptz;

create or replace function public.capture_account_priority_change()
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

drop trigger if exists account_readiness_snapshots_priority_change on public.account_readiness_snapshots;
create trigger account_readiness_snapshots_priority_change
  before update on public.account_readiness_snapshots
  for each row
  execute function public.capture_account_priority_change();
