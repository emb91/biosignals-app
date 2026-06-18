-- Customer-facing roles cannot call billing mutation RPCs directly. The
-- server-side Supabase service role needs explicit execution permission.

grant execute on function public.grant_org_credit_bucket(
  uuid, text, numeric, timestamptz, timestamptz, text, jsonb
) to service_role;
grant execute on function public.reserve_org_credits(
  uuid, uuid, text, numeric, text, text, text, text[], jsonb
) to service_role;
grant execute on function public.settle_org_credits(uuid, numeric)
  to service_role;
grant execute on function public.refund_org_credits(uuid)
  to service_role;
grant execute on function public.check_and_increment_usage(
  uuid, uuid, text, numeric, text, timestamptz, timestamptz, numeric, jsonb
) to service_role;
