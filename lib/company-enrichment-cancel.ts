type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type CompanyEnrichmentCancelResult =
  | { found: false }
  | { found: true; status: string | null; alreadyFinished: true }
  | { found: true; status: 'cancelled'; alreadyFinished: false };

export async function cancelCompanyEnrichmentForUser(
  supabase: SupabaseLike,
  userId: string,
  companyId: string,
  now: () => Date = () => new Date(),
): Promise<CompanyEnrichmentCancelResult> {
  const { data: owned, error: ownershipError } = await supabase
    .from('user_companies')
    .select('company_id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (ownershipError) {
    throw new Error(`company ownership check failed: ${ownershipError.message ?? 'unknown error'}`);
  }
  if (!owned) return { found: false };

  const { data: row, error: rowError } = await supabase
    .from('companies')
    .select('enrichment_refresh_status')
    .eq('id', companyId)
    .maybeSingle();

  if (rowError) {
    throw new Error(`company enrichment status lookup failed: ${rowError.message ?? 'unknown error'}`);
  }

  const status = (row as { enrichment_refresh_status?: string | null } | null)?.enrichment_refresh_status ?? null;
  if (!row || status !== 'running') {
    return { found: true, status, alreadyFinished: true };
  }

  const finishedAt = now().toISOString();
  const { error: updateError } = await supabase
    .from('companies')
    .update({
      enrichment_refresh_status: 'cancelled',
      enrichment_refresh_finished_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq('id', companyId);

  if (updateError) {
    throw new Error(`company enrichment cancellation failed: ${updateError.message ?? 'unknown error'}`);
  }

  return { found: true, status: 'cancelled', alreadyFinished: false };
}
