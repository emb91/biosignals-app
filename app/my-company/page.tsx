'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { parseSSEStream } from '@/lib/sse';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';
import { ProfileCard, type PanelMyCompanyData, type MyCompanyChangeValue, type CompetitorItem } from '@/components/SetupProfilePanel';
import { Pencil, RefreshCw, Save, X, Building2, ArrowRight, ChevronDown, ExternalLink, Check, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { ROUTES } from '@/lib/routes';
import { useSetupState } from '@/lib/use-setup-state';

const REENRICH_LINKEDIN_LINES = [
  'LinkedIn located ✓ Pulling logo, tagline, and followers from the public page…',
  'Still working ✓ LinkedIn can take 20 to 40 seconds, hang tight…',
  'Almost there ✓ Parsing location, specialties, and follower reach…',
] as const;

const REENRICH_SYNTHESIS_LINES = [
  'Merging web, registry, and LinkedIn signals…',
  'Condensing lists so your profile is easy to scan…',
  'Mapping company type and therapy areas to our taxonomy…',
] as const;

const FIELD_MAP: Record<string, string> = {
  companyName: 'company_name',
  website: 'website',
  logoUrl: 'logo_url',
  tagline: 'tagline',
  linkedinUrl: 'linkedin_url',
  description: 'description',
  customersWeServe: 'customers_we_serve',
  valuePropositions: 'value_propositions',
  goodFit: 'good_fit',
  badFit: 'bad_fit',
  buyerPrerequisites: 'buyer_prerequisites',
  buyerDisqualifiers: 'buyer_disqualifiers',
  competitorsEnriched: 'competitors_enriched',
  companyStatus: 'company_status',
  companyType: 'company_type',
  companyTypeDisplay: 'company_type_display',
  platformCategory: 'platform_category',
  therapeuticAreas: 'therapeutic_areas',
  modalities: 'modalities',
  developmentStages: 'development_stages',
  productsServices: 'products_services',
  services: 'services',
  technologies: 'technologies',
  employeeCount: 'employee_count',
  employeeRange: 'employee_range',
  followerCount: 'follower_count',
  foundedYear: 'founded_year',
  fundingStage: 'funding_stage',
  totalFundingUsd: 'total_funding_usd',
  hqCity: 'hq_city',
  hqCountry: 'hq_country',
  industry: 'industry',
};

function toMyCompany(d: Record<string, unknown>): PanelMyCompanyData {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const arr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined);

  return {
    companyName: str(d.company_name),
    website: str(d.website),
    logoUrl: str(d.logo_url),
    tagline: str(d.tagline),
    linkedinUrl: str(d.linkedin_url),
    description: arr(d.description) ?? (str(d.description) ? [d.description as string] : undefined),
    customersWeServe: arr(d.customers_we_serve),
    valuePropositions: arr(d.value_propositions),
    goodFit: arr(d.good_fit),
    badFit: arr(d.bad_fit),
    buyerPrerequisites: arr(d.buyer_prerequisites),
    buyerDisqualifiers: arr(d.buyer_disqualifiers),
    competitorsEnriched: Array.isArray(d.competitors_enriched)
      ? (d.competitors_enriched as CompetitorItem[])
      : undefined,
    companyStatus: str(d.company_status),
    companyType: str(d.company_type),
    companyTypeDisplay: str(d.company_type_display),
    platformCategory: str(d.platform_category),
    therapeuticAreas: arr(d.therapeutic_areas),
    modalities: arr(d.modalities),
    developmentStages: arr(d.development_stages),
    productsServices: arr(d.products_services),
    services: arr(d.services),
    technologies: arr(d.technologies),
    employeeCount: num(d.employee_count),
    employeeRange: str(d.employee_range),
    followerCount: num(d.follower_count),
    foundedYear: num(d.founded_year),
    fundingStage: str(d.funding_stage),
    totalFundingUsd: num(d.total_funding_usd),
    hqCity: str(d.hq_city),
    hqCountry: str(d.hq_country),
    industry: str(d.industry),
  };
}

// ── Light glass section card (collapsible) ──────────────────────────────────
function McSection({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-arcova-navy/8 bg-white/55">
      <header
        className="flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-white/45"
        onClick={() => setOpen((o) => !o)}
      >
        <h3 className="m-0 font-manrope text-[13.5px] font-semibold tracking-[-0.012em] text-arcova-navy">
          {label}
        </h3>
        <ChevronDown
          className={`h-3.5 w-3.5 text-arcova-navy/50 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </header>
      {open && (
        <div className="border-t border-arcova-navy/8 px-4 pb-4 pt-3.5">{children}</div>
      )}
    </section>
  );
}

function McTag({ children, link }: { children: React.ReactNode; link?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-arcova-teal/22 bg-arcova-teal/10 px-2.5 py-1.5 text-[12.5px] font-medium tracking-[-0.005em] text-arcova-teal ${
        link ? 'cursor-pointer hover:bg-arcova-teal/18' : ''
      }`}
    >
      {children}
      {link && <ExternalLink className="h-2.5 w-2.5 opacity-70" />}
    </span>
  );
}

function McTagRow({ items, link }: { items: string[]; link?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <McTag key={`${t}-${i}`} link={link}>
          {t}
        </McTag>
      ))}
    </div>
  );
}

function McSubLabel({ children, mt }: { children: React.ReactNode; mt?: boolean }) {
  return (
    <p
      className={`${mt ? 'mt-3' : 'mt-0'} mb-2 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/40`}
    >
      {children}
    </p>
  );
}

function McKV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 gap-x-6 sm:grid-cols-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/40">
            {k}
          </div>
          <div className="text-[13px] font-medium text-arcova-navy">{v}</div>
        </div>
      ))}
    </div>
  );
}

function McBullets({ items, sub }: { items: string[]; sub?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      {sub && <McSubLabel mt>{sub}</McSubLabel>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((t, i) => (
          <li
            key={i}
            className="relative pl-3.5 text-[12.5px] leading-[1.5] text-arcova-navy/75 before:absolute before:left-1 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-arcova-teal/70 before:content-['']"
          >
            {t}
          </li>
        ))}
      </ul>
    </>
  );
}

function formatFunding(stage?: string, total?: number): string | undefined {
  if (!stage && total == null) return undefined;
  const fmtUsd = (usd: number) => {
    if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
    if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
    if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
    return `$${usd}`;
  };
  if (stage && total != null) return `${stage} · ${fmtUsd(total)}`;
  if (stage) return stage;
  return total != null ? fmtUsd(total) : undefined;
}

export default function MyProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // "My company" is org-level setup — only owner/admin may edit/re-enrich.
  const { canEditOrgSetup } = useSetupState();

  const [analysisData, setAnalysisData] = useState<Record<string, unknown> | null>(null);
  const [editedData, setEditedData] = useState<Record<string, unknown> | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReenriching, setIsReenriching] = useState(false);
  const [reenrichMsg, setReenrichMsg] = useState('');
  const [reenrichPct, setReenrichPct] = useState(0);
  const [showChangeInput, setShowChangeInput] = useState(false);
  const [changeUrl, setChangeUrl] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const reloadUserCompanyFromDb = useCallback(async (): Promise<Record<string, unknown> | null> => {
    if (!user?.id) return null;
    const { data, error } = await supabase
      .from('user_company')
      .select('*')
      .eq('user_id', user.id)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return normalizePlatformTaxonomyFields(data as Record<string, unknown>);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const row = await reloadUserCompanyFromDb();
        if (row) {
          setAnalysisData(row);
          setEditedData(row);
        }
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user, reloadUserCompanyFromDb]);

  const handleChange = useCallback((field: keyof PanelMyCompanyData, value: MyCompanyChangeValue) => {
    const rawKey = FIELD_MAP[field as string] ?? field;
    setEditedData((prev) => ({ ...(prev ?? {}), [rawKey]: value }));
  }, []);

  const handleSave = async () => {
    if (!editedData) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/user-company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedData),
      });
      if (res.ok) {
        const updated = await res.json();
        const normalized = normalizePlatformTaxonomyFields(updated as Record<string, unknown>);
        setAnalysisData(normalized);
        setEditedData(normalized);
      }
    } finally {
      setIsSaving(false);
      setEditMode(false);
    }
  };

  const handleCancel = () => {
    setEditedData(analysisData);
    setEditMode(false);
  };

  const runEnrichment = async (website: string) => {
    const normalized = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
    setIsReenriching(true);
    setReenrichMsg('Researching your company…');
    setReenrichPct(0);
    let finalData: Record<string, unknown> | null = null;
    try {
      const res = await fetch('/api/analyze-and-store-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: normalized }),
      });
      if (!res.ok) {
        return;
      }
      for await (const { event, data } of parseSSEStream(res)) {
        if (event === 'step_claude') {
          setReenrichMsg('Website analysed ✓  Checking company database…');
          setReenrichPct(30);
        } else if (event === 'step_apollo') {
          setReenrichMsg('Company and web data in ✓ Resolving LinkedIn…');
          setReenrichPct(55);
        } else if (event === 'step_linkedin') {
          const found = Boolean(data.linkedin_found);
          if (found) {
            setReenrichMsg(REENRICH_LINKEDIN_LINES[0]);
          } else {
            setReenrichMsg('No public LinkedIn company URL found ✓ Enriching from site and registry only…');
          }
        } else if (event === 'step_apify') {
          setReenrichMsg('Sources merged ✓ Organizing profile…');
          setReenrichPct(75);
        } else if (event === 'step_synthesis') {
          setReenrichMsg(REENRICH_SYNTHESIS_LINES[0]);
        } else if (event === 'step_taxonomy') {
          setReenrichMsg('Classified ✓  Finishing up…');
          setReenrichPct(92);
        } else if (event === 'done') {
          finalData = data;
        } else if (event === 'error') {
          return;
        }
      }
      if (finalData) {
        const normalizedRow = normalizePlatformTaxonomyFields(finalData);
        setAnalysisData(normalizedRow);
        setEditedData(normalizedRow);
      }
    } finally {
      if (!finalData) {
        const restored = await reloadUserCompanyFromDb();
        if (restored) {
          setAnalysisData(restored);
          setEditedData(restored);
        }
      }
      setIsReenriching(false);
      setReenrichMsg('');
      setReenrichPct(0);
    }
  };

  const handleReenrich = async () => {
    const website = typeof analysisData?.website === 'string' ? analysisData.website : null;
    if (!website) return;
    await runEnrichment(website);
  };

  const handleChangeCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = changeUrl.trim();
    if (!url) return;
    setShowChangeInput(false);
    setChangeUrl('');
    await runEnrichment(url);
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const myCompanyData = toMyCompany(editedData ?? {});

  return (
    <div className="flex h-screen min-h-0 bg-transparent font-jakarta">
      <AppSidebar />
      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-[1180px]">

          <PageHeader
            eyebrow="About you · My company"
            title="Your company profile"
            subtitle="Used to build target criteria, define buying personas, and find the right leads."
            action={analysisData && !editMode && canEditOrgSetup ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setShowChangeInput((v) => !v); setChangeUrl(''); }}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-teal/25 bg-arcova-teal/10 px-3.5 py-2 text-[12.5px] font-medium text-[#00707b] transition-all hover:-translate-y-px hover:bg-arcova-teal/16"
                >
                  <RefreshCw className="h-3.5 w-3.5 opacity-80" /> Change my company
                </button>
                <button
                  type="button"
                  onClick={handleReenrich}
                  disabled={isReenriching}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-navy/10 bg-white/70 px-3.5 py-2 text-[12.5px] font-medium text-arcova-navy backdrop-blur transition-all hover:-translate-y-px hover:bg-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 opacity-80 ${isReenriching ? 'animate-spin' : ''}`} />
                  {isReenriching ? 'Re-enriching…' : 'Re-enrich'}
                </button>
              </div>
            ) : undefined}
          />

          {/* ── Change company inline input ── */}
          {showChangeInput && !isReenriching && (
            <div className="mb-6 rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 px-5 py-4">
              <p className="mb-3 text-sm font-medium text-arcova-navy/70">
                Enter the website of your new company and we'll analyse it.
              </p>
              <form onSubmit={handleChangeCompanySubmit} className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={changeUrl}
                  onChange={(e) => setChangeUrl(e.target.value)}
                  placeholder="e.g. newcompany.com"
                  className="flex-1 rounded-lg border border-arcova-navy/10 bg-white/70 px-3 py-2 text-sm text-arcova-navy placeholder-arcova-navy/30 outline-none focus:border-arcova-teal/50 focus:ring-1 focus:ring-arcova-teal/20"
                />
                <button
                  type="submit"
                  disabled={!changeUrl.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85 disabled:opacity-40"
                >
                  <ArrowRight className="h-4 w-4" /> Analyse
                </button>
                <button
                  type="button"
                  onClick={() => { setShowChangeInput(false); setChangeUrl(''); }}
                  className="inline-flex items-center rounded-lg border border-arcova-navy/10 px-3 py-2 text-sm text-arcova-navy/45 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy"
                >
                  <X className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}

          {/* Re-enrichment progress — above company card so it is not anchored to section footers */}
          {isReenriching && !editMode && (
            <div className="mb-6 rounded-xl border border-arcova-teal/20 bg-arcova-teal/5 px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[12.5px]">
                <span className="font-medium text-arcova-navy">{reenrichMsg || 'Re-enriching…'}</span>
                <span className="font-mono text-[11px] text-arcova-navy/60">{reenrichPct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-arcova-navy/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-arcova-teal to-[#007e8b] transition-[width] duration-700"
                  style={{ width: `${reenrichPct}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Main card: read-only glass layout, or full editor (shared ProfileCard) when editing ── */}
          {editMode && analysisData ? (
            <article className="overflow-hidden rounded-[22px] border border-arcova-navy/10 bg-white/65 backdrop-blur-xl shadow-arcova">
              <header className="flex items-center gap-2.5 border-b border-arcova-navy/8 px-[18px] py-3.5">
                <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-arcova-teal/12 text-arcova-teal">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 font-manrope text-[14.5px] font-semibold tracking-[-0.014em] text-arcova-navy">
                  Your company · Editing
                </span>
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-arcova-teal text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </header>
              <div className="px-[18px] pb-6 pt-4 sm:px-[22px]">
                <ProfileCard
                  appearance="light"
                  hideCompanyHeader
                  status="complete"
                  myCompany={myCompanyData}
                  analysisLoading={false}
                  editMode
                  onMyCompanyChange={handleChange}
                  defaultAllOpen
                  columns={2}
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-arcova-navy/[0.06] px-[22px] py-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-navy/10 bg-white/70 px-3.5 py-2 text-[12.5px] font-medium text-arcova-navy backdrop-blur transition-all hover:-translate-y-px hover:bg-white disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-arcova-teal px-3.5 py-2 text-[12.5px] font-semibold text-white transition-all hover:bg-arcova-teal/85 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </article>
          ) : (
          <article className="overflow-hidden rounded-[22px] border border-arcova-navy/10 bg-white/65 backdrop-blur-xl shadow-arcova">
            <div className="flex flex-col gap-[22px] px-[22px] pb-6 pt-[22px]">
              {/* Hero row */}
              <div className="flex items-start gap-3.5 px-1 pb-0.5 pt-1">
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-arcova-teal to-[#007e8b] text-white shadow-[0_8px_18px_-8px_rgba(0,164,180,0.6)]">
                  {myCompanyData.logoUrl ? (
                    <Image
                      src={myCompanyData.logoUrl}
                      alt={myCompanyData.companyName ?? 'Company'}
                      width={48}
                      height={48}
                      className="h-12 w-12 object-cover"
                    />
                  ) : (
                    <span className="font-manrope text-base font-bold">
                      {(myCompanyData.companyName?.[0] ?? 'A').toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="mb-0.5 font-manrope text-[19px] font-semibold tracking-[-0.014em] text-arcova-navy">
                    {myCompanyData.companyName ?? '—'}
                  </div>
                  {myCompanyData.website && (
                    <a
                      href={
                        /^https?:\/\//i.test(myCompanyData.website)
                          ? myCompanyData.website
                          : `https://${myCompanyData.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12.5px] text-arcova-teal hover:underline"
                    >
                      {myCompanyData.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  {myCompanyData.tagline && (
                    <div className="mt-2 max-w-[720px] text-[13.5px] italic leading-[1.5] text-arcova-navy/70">
                      {myCompanyData.tagline}
                    </div>
                  )}
                </div>
              </div>

              {/* 2-column section grid */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Left column */}
                <div className="flex min-w-0 flex-col gap-3.5">
                  <McSection label="About">
                    {myCompanyData.description && myCompanyData.description.length > 0 && (
                      <p className="m-0 text-[13px] leading-[1.55] text-arcova-navy">
                        {myCompanyData.description.join(' ')}
                      </p>
                    )}
                    {(myCompanyData.companyTypeDisplay || myCompanyData.companyType) && (
                      <>
                        <McSubLabel mt>Company type</McSubLabel>
                        <McTagRow
                          items={[(myCompanyData.companyTypeDisplay ?? myCompanyData.companyType) as string]}
                        />
                      </>
                    )}
                    {myCompanyData.platformCategory && (
                      <>
                        <McSubLabel mt>Platform category</McSubLabel>
                        <McTagRow items={[myCompanyData.platformCategory]} />
                      </>
                    )}
                    {myCompanyData.therapeuticAreas && myCompanyData.therapeuticAreas.length > 0 && (
                      <>
                        <McSubLabel mt>Therapeutic areas</McSubLabel>
                        <McTagRow items={myCompanyData.therapeuticAreas} />
                      </>
                    )}
                    {myCompanyData.modalities && myCompanyData.modalities.length > 0 && (
                      <>
                        <McSubLabel mt>Modalities</McSubLabel>
                        <McTagRow items={myCompanyData.modalities} />
                      </>
                    )}
                  </McSection>

                  <McSection label="Firmographics">
                    <McKV
                      rows={[
                        myCompanyData.employeeCount != null
                          ? (['Employees', String(myCompanyData.employeeCount)] as [string, React.ReactNode])
                          : myCompanyData.employeeRange
                            ? (['Employees', myCompanyData.employeeRange] as [string, React.ReactNode])
                            : null,
                        myCompanyData.foundedYear != null
                          ? (['Founded', String(myCompanyData.foundedYear)] as [string, React.ReactNode])
                          : null,
                        myCompanyData.industry
                          ? (['Industry', myCompanyData.industry] as [string, React.ReactNode])
                          : null,
                        (myCompanyData.hqCity || myCompanyData.hqCountry)
                          ? ([
                              'Headquarters',
                              [myCompanyData.hqCity, myCompanyData.hqCountry].filter(Boolean).join(', '),
                            ] as [string, React.ReactNode])
                          : null,
                        myCompanyData.companyStatus
                          ? (['Status', myCompanyData.companyStatus] as [string, React.ReactNode])
                          : formatFunding(myCompanyData.fundingStage, myCompanyData.totalFundingUsd)
                            ? ([
                                'Status',
                                formatFunding(myCompanyData.fundingStage, myCompanyData.totalFundingUsd)!,
                              ] as [string, React.ReactNode])
                            : null,
                      ].filter(Boolean) as Array<[string, React.ReactNode]>}
                    />
                  </McSection>

                  {myCompanyData.competitorsEnriched && myCompanyData.competitorsEnriched.length > 0 && (
                    <McSection label="Competitors">
                      <McTagRow
                        link
                        items={myCompanyData.competitorsEnriched.map((c: CompetitorItem) => c.name).filter(Boolean) as string[]}
                      />
                    </McSection>
                  )}

                  {((myCompanyData.buyerPrerequisites && myCompanyData.buyerPrerequisites.length > 0) ||
                    (myCompanyData.buyerDisqualifiers && myCompanyData.buyerDisqualifiers.length > 0)) && (
                    <McSection label="Buyer requirements">
                      {myCompanyData.buyerPrerequisites && myCompanyData.buyerPrerequisites.length > 0 && (
                        <McBullets items={myCompanyData.buyerPrerequisites} sub="Prerequisites" />
                      )}
                      {myCompanyData.buyerDisqualifiers && myCompanyData.buyerDisqualifiers.length > 0 && (
                        <McBullets items={myCompanyData.buyerDisqualifiers} sub="Disqualifiers" />
                      )}
                    </McSection>
                  )}

                  {myCompanyData.valuePropositions && myCompanyData.valuePropositions.length > 0 && (
                    <McSection label="Value props">
                      <McBullets items={myCompanyData.valuePropositions} />
                    </McSection>
                  )}
                </div>

                {/* Right column */}
                <div className="flex min-w-0 flex-col gap-3.5">
                  <McSection label="Customers">
                    {myCompanyData.customersWeServe && myCompanyData.customersWeServe.length > 0 && (
                      <McTagRow items={myCompanyData.customersWeServe} />
                    )}
                    {myCompanyData.goodFit && myCompanyData.goodFit.length > 0 && (
                      <McBullets items={myCompanyData.goodFit} sub="Good fit" />
                    )}
                    {myCompanyData.badFit && myCompanyData.badFit.length > 0 && (
                      <McBullets items={myCompanyData.badFit} sub="Not a fit" />
                    )}
                  </McSection>

                  {((myCompanyData.productsServices && myCompanyData.productsServices.length > 0) ||
                    (myCompanyData.services && myCompanyData.services.length > 0) ||
                    (myCompanyData.technologies && myCompanyData.technologies.length > 0)) && (
                    <McSection label="Products, Services, Tech">
                      {myCompanyData.productsServices && myCompanyData.productsServices.length > 0 && (
                        <>
                          <McSubLabel>Products</McSubLabel>
                          <McTagRow items={myCompanyData.productsServices} />
                        </>
                      )}
                      {myCompanyData.services && myCompanyData.services.length > 0 && (
                        <>
                          <McSubLabel mt>Services</McSubLabel>
                          <McTagRow items={myCompanyData.services} />
                        </>
                      )}
                      {myCompanyData.technologies && myCompanyData.technologies.length > 0 && (
                        <>
                          <McSubLabel mt>Technologies</McSubLabel>
                          <McTagRow items={myCompanyData.technologies} />
                        </>
                      )}
                    </McSection>
                  )}

                  {(myCompanyData.followerCount != null || myCompanyData.linkedinUrl) && (
                    <McSection label="Social">
                      {myCompanyData.followerCount != null && (
                        <McKV rows={[['LinkedIn followers', String(myCompanyData.followerCount)]]} />
                      )}
                      {myCompanyData.linkedinUrl && (
                        <>
                          <McSubLabel mt>LinkedIn</McSubLabel>
                          <a
                            href={myCompanyData.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12.5px] text-arcova-teal hover:underline"
                          >
                            {myCompanyData.linkedinUrl
                              .replace(/^https?:\/\//, '')
                              .replace(/\/$/, '')}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </>
                      )}
                    </McSection>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end border-t border-arcova-navy/[0.06] px-[22px] py-3">
              {canEditOrgSetup ? (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  disabled={isReenriching}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-navy/10 bg-white/70 px-3.5 py-2 text-[12.5px] font-medium text-arcova-navy backdrop-blur transition-all hover:-translate-y-px hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5 opacity-70" /> Edit
                </button>
              ) : (
                <span className="text-[12px] text-arcova-navy/45">
                  Only an owner or admin can edit the company profile.
                </span>
              )}
            </div>
          </article>
          )}

        </div>
      </main>

    </div>
  );
}
