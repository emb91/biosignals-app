-- Cover nullable foreign keys on shared cadence sweep targets.
-- These rows are service-role managed, but deletes/updates of organizations
-- still benefit from indexes on the referencing columns.

create index if not exists idx_account_source_sweep_targets_fastest_org
  on public.account_source_sweep_targets(fastest_org_id)
  where fastest_org_id is not null;

create index if not exists idx_contact_source_sweep_targets_fastest_org
  on public.contact_source_sweep_targets(fastest_org_id)
  where fastest_org_id is not null;
