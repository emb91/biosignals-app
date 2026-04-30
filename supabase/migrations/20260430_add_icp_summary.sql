alter table if exists public.icps
  add column if not exists icp_summary text;
