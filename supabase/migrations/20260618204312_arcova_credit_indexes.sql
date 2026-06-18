-- Cover foreign keys used by deletes, audits and provider-cost reconciliation.

create index if not exists idx_org_credit_allocations_bucket
  on public.org_credit_allocations (bucket_id);
create index if not exists idx_org_credit_transactions_user
  on public.org_credit_transactions (user_id)
  where user_id is not null;
create index if not exists idx_org_usage_events_user
  on public.org_usage_events (user_id)
  where user_id is not null;
create index if not exists idx_org_monitored_contacts_person
  on public.org_monitored_contacts (person_id);
create index if not exists idx_org_monitored_accounts_company
  on public.org_monitored_accounts (company_id);
create index if not exists idx_apify_run_usage_user
  on public.apify_run_usage (user_id)
  where user_id is not null;
create index if not exists idx_apify_run_usage_credit_transaction
  on public.apify_run_usage (customer_credit_transaction_id)
  where customer_credit_transaction_id is not null;
