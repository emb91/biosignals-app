import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type CompanyAggRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  company_website: string | null;
  logo_url: string | null;
  company_fit_score: number | null;
  matched_icp_id: string | null;
};

type AggregatedAccount = CompanyAggRow & {
  contact_count: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
  avg_contact_fit: number | null;
};

type ScratchAgg = CompanyAggRow & {
  contact_count: number;
  fit_sum: number;
  fit_n: number;
  best_contact_fit: number | null;
  worst_contact_fit: number | null;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseThreshold(raw: string | null, fallback: number): number {
  const n = parseFloat(raw ?? '');
  if (!Number.isFinite(n)) return fallback;
  return clamp01(n);
}

function finalizeScratch(row: ScratchAgg): AggregatedAccount {
  return {
    id: row.id,
    company_name: row.company_name,
    domain: row.domain,
    company_website: row.company_website,
    logo_url: row.logo_url,
    company_fit_score: row.company_fit_score,
    matched_icp_id: row.matched_icp_id,
    contact_count: row.contact_count,
    best_contact_fit: row.best_contact_fit,
    worst_contact_fit: row.worst_contact_fit,
    avg_contact_fit: row.fit_n > 0 ? row.fit_sum / row.fit_n : null,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = (searchParams.get('search') || '').trim();

    const minCompanyFit = parseThreshold(searchParams.get('minCompanyFit'), 0.65);
    const maxBestContactFit = parseThreshold(searchParams.get('maxBestContactFit'), 0.45);

    const { data: rows, error } = await supabase
      .from('contacts')
      .select(
        `
        company_id,
        contact_fit_score,
        companies (
          id,
          company_name,
          domain,
          company_website,
          logo_url,
          company_fit_score,
          matched_icp_id
        )
      `,
      )
      .eq('user_id', user.id)
      .not('company_id', 'is', null);

    if (error) {
      console.error('Error fetching contacts for accounts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const byCompany = new Map<string, ScratchAgg>();

    for (const row of rows || []) {
      const companyId = row.company_id as string | null;
      const company = row.companies as CompanyAggRow | CompanyAggRow[] | null;
      const resolvedCompany = Array.isArray(company) ? company[0] : company;

      if (!companyId || !resolvedCompany?.id) continue;

      const contactFit =
        typeof row.contact_fit_score === 'number' && Number.isFinite(row.contact_fit_score)
          ? row.contact_fit_score
          : null;

      const existing = byCompany.get(companyId);
      if (!existing) {
        byCompany.set(companyId, {
          ...resolvedCompany,
          contact_count: 1,
          fit_sum: contactFit ?? 0,
          fit_n: contactFit == null ? 0 : 1,
          best_contact_fit: contactFit,
          worst_contact_fit: contactFit,
        });
      } else {
        existing.contact_count += 1;
        if (contactFit != null) {
          existing.fit_sum += contactFit;
          existing.fit_n += 1;
          existing.best_contact_fit =
            existing.best_contact_fit == null
              ? contactFit
              : Math.max(existing.best_contact_fit, contactFit);
          existing.worst_contact_fit =
            existing.worst_contact_fit == null
              ? contactFit
              : Math.min(existing.worst_contact_fit, contactFit);
        }
      }
    }

    let accounts: AggregatedAccount[] = [...byCompany.values()].map(finalizeScratch);

    accounts = accounts.filter((account) => {
      const companyFit =
        typeof account.company_fit_score === 'number' && Number.isFinite(account.company_fit_score)
          ? account.company_fit_score
          : null;
      if (companyFit == null || companyFit < minCompanyFit) return false;

      const best =
        typeof account.best_contact_fit === 'number' && Number.isFinite(account.best_contact_fit)
          ? account.best_contact_fit
          : 0;

      return best <= maxBestContactFit;
    });

    if (search) {
      const q = search.toLowerCase();
      accounts = accounts.filter((account) => {
        const name = (account.company_name || '').toLowerCase();
        const domain = (account.domain || '').toLowerCase();
        return name.includes(q) || domain.includes(q);
      });
    }

    accounts.sort((a, b) => {
      const cfA =
        typeof a.company_fit_score === 'number' && Number.isFinite(a.company_fit_score)
          ? a.company_fit_score
          : 0;
      const cfB =
        typeof b.company_fit_score === 'number' && Number.isFinite(b.company_fit_score)
          ? b.company_fit_score
          : 0;
      if (cfB !== cfA) return cfB - cfA;

      const bestA =
        typeof a.best_contact_fit === 'number' && Number.isFinite(a.best_contact_fit)
          ? a.best_contact_fit
          : 0;
      const bestB =
        typeof b.best_contact_fit === 'number' && Number.isFinite(b.best_contact_fit)
          ? b.best_contact_fit
          : 0;
      return bestA - bestB;
    });

    const total = accounts.length;
    const offset = (page - 1) * pageSize;
    const slice = accounts.slice(offset, offset + pageSize);

    let icpLabels = new Map<string, string>();

    const needsIcps = slice.some((a) => Boolean(a.matched_icp_id));
    if (needsIcps) {
      const { data: icps, error: icpError } = await supabase
        .from('icps')
        .select('id, name, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!icpError && icps) {
        const ordered = icps as Array<{ id: string; name: string | null }>;
        const indexById = new Map(ordered.map((row, index) => [row.id, index + 1]));
        icpLabels = new Map(
          ordered.map((row) => {
            const idx = indexById.get(row.id);
            const label =
              idx != null && row.name?.trim()
                ? `ICP ${idx}: ${row.name}`
                : row.name?.trim() || (idx != null ? `ICP ${idx}` : null);
            return [row.id, label ?? ''];
          }),
        );
      }
    }

    const data = slice.map((account) => ({
      ...account,
      matched_icp_label: account.matched_icp_id
        ? icpLabels.get(account.matched_icp_id) ?? null
        : null,
    }));

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      thresholds: { minCompanyFit, maxBestContactFit },
    });
  } catch (err) {
    console.error('Error in accounts GET:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
