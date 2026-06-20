-- Make the internal-only posture explicit to the database advisor as well as
-- privileges: browser roles can neither read nor write cron telemetry.
create policy cron_run_history_no_client_access
  on public.cron_run_history
  for all
  to anon, authenticated
  using (false)
  with check (false);
