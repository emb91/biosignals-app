'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { parseSSEStream } from '@/lib/sse';
import AppSidebar from '@/components/AppSidebar';
import { AppWarningBanner } from '@/components/AppWarningBanner';
import { ProfileCard, type PanelMyCompanyData, type MyCompanyChangeValue, type CompetitorItem } from '@/components/SetupProfilePanel';
import { Pencil, RefreshCw, Trash2, Save, X, AlertTriangle, Building2, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ROUTES } from '@/lib/routes';

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

export default function MyProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [analysisData, setAnalysisData] = useState<Record<string, unknown> | null>(null);
  const [editedData, setEditedData] = useState<Record<string, unknown> | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReenriching, setIsReenriching] = useState(false);
  const [reenrichMsg, setReenrichMsg] = useState('');
  const [reenrichPct, setReenrichPct] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const handleDelete = async () => {
    const id = typeof analysisData?.id === 'string' ? analysisData.id : null;
    if (id) {
      await fetch(`/api/user-company?id=${id}`, { method: 'DELETE' }).catch(() => {});
    }
    router.replace(ROUTES.today);
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
          setReenrichMsg('Company data retrieved ✓  Scanning LinkedIn…');
          setReenrichPct(55);
        } else if (event === 'step_apify') {
          setReenrichMsg('LinkedIn scanned ✓  Classifying company…');
          setReenrichPct(75);
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 to-arcova-darkblue">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const myCompanyData = toMyCompany(editedData ?? {});
  const cardStatus = isReenriching ? 'building' : (analysisData ? 'complete' : 'pending');

  return (
    <div className="flex h-screen bg-gradient-to-b from-slate-950 to-arcova-darkblue">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-6xl">

            {/* ── Page header ── */}
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">Your company profile</h1>
                <p className="mt-1 text-sm text-white/40">
                  Used to build target criteria, define buying personas, and find the right leads.
                </p>
              </div>

              {/* Action buttons */}
              {analysisData && (
                <div className="flex items-center gap-2 shrink-0">
                  {editMode ? (
                    <>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        {isSaving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { setShowChangeInput((v) => !v); setChangeUrl(''); }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85"
                      >
                        <Building2 className="h-4 w-4" /> Change my company
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal px-4 py-2 text-sm font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
                      >
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={handleReenrich}
                        disabled={isReenriching}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${isReenriching ? 'animate-spin' : ''}`} />
                        {isReenriching ? 'Re-enriching…' : 'Re-enrich'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-4 py-2 text-sm font-medium text-red-400/70 transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Change company inline input ── */}
            {showChangeInput && !isReenriching && (
              <div className="mb-6 rounded-xl border border-arcova-teal/30 bg-arcova-teal/5 px-5 py-4">
                <p className="mb-3 text-sm font-medium text-white/80">
                  Enter the website of your new company and we'll analyse it.
                </p>
                <form onSubmit={handleChangeCompanySubmit} className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={changeUrl}
                    onChange={(e) => setChangeUrl(e.target.value)}
                    placeholder="e.g. newcompany.com"
                    className="flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-arcova-teal/60 focus:ring-1 focus:ring-arcova-teal/30"
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
                    className="inline-flex items-center rounded-lg border border-white/15 px-3 py-2 text-sm text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}

            {/* ── Card — bump text sizes up from sidebar-scale to page-scale ── */}
            <div className="[&_.text-xs]:text-[0.9375rem] [&_.text-xs]:leading-normal [&_.text-sm]:text-base [&_.text-sm]:leading-relaxed">
              <ProfileCard
                status={cardStatus}
                myCompany={myCompanyData}
                analysisLoading={isReenriching}
                enrichmentMsg={reenrichMsg}
                enrichmentPct={reenrichPct}
                editMode={editMode && !isSaving}
                defaultAllOpen
                columns={2}
                onMyCompanyChange={handleChange}
              />
            </div>

            {editMode && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(false)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <h2 id="delete-modal-title" className="mb-2 text-lg font-semibold text-white">
              Delete company profile?
            </h2>
            <AppWarningBanner
              layout="compact"
              tone="danger"
              className="mb-4"
              title="This cannot be undone. Your profile is deleted from the database."
            />
            <p className="mb-6 text-sm leading-relaxed text-white/55">
              This will remove your company analysis, including enriched data, narrative fields, and firmographics. You will need to run setup and analysis again.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600"
              >
                <Trash2 className="h-4 w-4" /> Yes, delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
