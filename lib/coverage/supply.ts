/**
 * Addressable-supply estimator for the Coverage planner.
 *
 * Answers "can this ICP even supply the contacts the target asks us to buy?"
 * by counting the Apollo company universe (`pagination.total_entries`, ~0.1
 * credits — a COUNT, never an enrich) for the ICP's strict recipe, subtracting
 * companies already held, and converting to a contact-level ceiling that the
 * allocation engine (lib/coverage/allocation.ts) consumes as `sourceableCeiling`.
 *
 * Everything here is an ESTIMATE and labelled as such:
 *  - total_entries is a count, so we can't exactly dedupe vs held companies; we
 *    approximate net-new as max(0, universe − heldCompanies).
 *  - contacts-per-company uses the ICP's observed sourced ratio when we have it,
 *    else DEFAULT_CONTACTS_PER_COMPANY.
 *
 * Impure (hits Apollo) and credit-spending — call ONLY on the prescriptive tier
 * (a target is set), and prefer caching the universe count at the call site.
 */
import { searchOrganizationsWithApollo } from '@/lib/apollo';
import { buildApolloCompanySearchRecipes, type AcquisitionIcp } from '@/lib/data-acquisition/search-spec';

/** Relevant buyers per target company when we have no observed ratio for the ICP. */
export const DEFAULT_CONTACTS_PER_COMPANY = 4;

export const ICP_SUPPLY_SELECT =
  'id, name, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, target_customers, buyer_types';

export type IcpSupplyEstimate = {
  icpId: string;
  /** Apollo company universe for the strict recipe (count only). null = lookup failed. */
  universeCompanies: number | null;
  heldCompanies: number;
  /** max(0, universe − held) — net-new sourceable companies (approximate dedupe). */
  netNewCompanies: number;
  contactsPerCompany: number;
  /** netNewCompanies × contactsPerCompany — the contact-level ceiling. null when universe unknown. */
  sourceableContacts: number | null;
  recipeName: string | null;
  /** Always true — this is a deduped estimate, surface it as such in the UI. */
  estimate: true;
};

/**
 * Estimate net-new sourceable contacts for one ICP. Uses the strict recipe (the
 * realistic addressable universe that actually matches the ICP), not the broadest
 * — so feasibility isn't overstated.
 */
export async function estimateIcpSupply(params: {
  icp: AcquisitionIcp;
  heldCompanies: number;
  /** Observed contacts/company for this ICP from icp-cards, when available. */
  contactsPerCompany?: number | null;
}): Promise<IcpSupplyEstimate> {
  const { icp, heldCompanies } = params;
  const contactsPerCompany =
    params.contactsPerCompany != null && params.contactsPerCompany > 0
      ? params.contactsPerCompany
      : DEFAULT_CONTACTS_PER_COMPANY;

  // Strict recipe first (most ICP-faithful); fall back to the next non-empty.
  const recipe = buildApolloCompanySearchRecipes(icp, 'expand_companies')[0] ?? null;

  const base: Omit<IcpSupplyEstimate, 'universeCompanies' | 'netNewCompanies' | 'sourceableContacts' | 'recipeName'> = {
    icpId: icp.id,
    heldCompanies: Math.max(0, heldCompanies),
    contactsPerCompany,
    estimate: true,
  };

  if (!recipe) {
    return { ...base, universeCompanies: null, netNewCompanies: 0, sourceableContacts: null, recipeName: null };
  }

  let universe: number | null = null;
  try {
    // per_page: 1 — we only want pagination.total_entries, not the rows.
    const res = await searchOrganizationsWithApollo({
      page: 1,
      perPage: 1,
      keywords: recipe.keywords,
      employeeRanges: recipe.employeeRanges.length ? recipe.employeeRanges : undefined,
      fundingStages: recipe.fundingStages.length ? recipe.fundingStages : undefined,
    });
    const total = res.pagination?.total_entries;
    universe = typeof total === 'number' && Number.isFinite(total) ? total : null;
  } catch (e) {
    console.error('[coverage/supply] Apollo count failed for icp', icp.id, e);
    universe = null;
  }

  if (universe == null) {
    return { ...base, universeCompanies: null, netNewCompanies: 0, sourceableContacts: null, recipeName: recipe.name };
  }

  const netNewCompanies = Math.max(0, universe - Math.max(0, heldCompanies));
  return {
    ...base,
    universeCompanies: universe,
    netNewCompanies,
    sourceableContacts: Math.floor(netNewCompanies * contactsPerCompany),
    recipeName: recipe.name,
  };
}
