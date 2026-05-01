'use client';

import { useState } from 'react';
import {
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  LI_FOLLOWER_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
  canonicalizeFundingStage,
} from '@/lib/arcova-taxonomy';
import type { TargetCompanyEnrichmentResult } from '@/lib/target-company-enrichment';

// ── Types ──────────────────────────────────────────────────────────────────

interface ReviewState {
  companyName: string;
  companyType: string;
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  customerTherapeuticAreas: string[];
  customerModalities: string[];
  customerDevelopmentStages: string[];
  companySizes: string[];
  fundingStages: string[];
  liFollowerSizes: string[];
}

type FlowPhase = 'url-input' | 'loading' | 'review' | 'saving';

interface Props {
  onComplete: () => void;
}

// ── Chip components ────────────────────────────────────────────────────────

function SingleChipGrid({
  options,
  selected,
  onSelect,
  emptyPrompt,
}: {
  options: readonly { value: string; description?: string }[];
  selected: string;
  onSelect: (v: string) => void;
  emptyPrompt: string;
}) {
  return (
    <div className="space-y-1.5">
      {!selected && (
        <p className="text-xs font-medium text-amber-600">{emptyPrompt}</p>
      )}
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onSelect(selected === o.value ? '' : o.value)}
            className={`w-full rounded-lg border-2 px-3 py-2 text-left text-sm transition-all ${
              selected === o.value
                ? 'border-arcova-teal bg-arcova-teal/5'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <span className={`font-medium ${selected === o.value ? 'text-arcova-teal' : 'text-gray-800'}`}>
              {o.value}
            </span>
            {o.description && (
              <span className="ml-2 text-xs text-gray-400">{o.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiChipGrid({
  options,
  selected,
  onToggle,
  emptyPrompt,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  emptyPrompt: string;
}) {
  return (
    <div className="space-y-1.5">
      {selected.length === 0 && (
        <p className="text-xs font-medium text-amber-600">{emptyPrompt}</p>
      )}
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              selected.includes(o)
                ? 'bg-arcova-teal text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Field section wrapper ──────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700">{label}</p>
      {children}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function UrlFirstICPFlow({ onComplete }: Props) {
  const [phase, setPhase] = useState<FlowPhase>('url-input');
  const [urlInput, setUrlInput] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('Visiting the website…');
  const [analysisError, setAnalysisError] = useState('');
  const [companyName, setCompanyName] = useState('');
  /** Full enrichment blob from /api/analyze-example-company — same snapshot we store on the ICP row. */
  const [enrichmentSnapshot, setEnrichmentSnapshot] = useState<TargetCompanyEnrichmentResult | null>(null);

  const [review, setReview] = useState<ReviewState>({
    companyName: '',
    companyType: '',
    therapeuticAreas: [],
    modalities: [],
    developmentStages: [],
    customerTherapeuticAreas: [],
    customerModalities: [],
    customerDevelopmentStages: [],
    companySizes: [],
    fundingStages: [],
    liFollowerSizes: [],
  });

  const toggle =
    (field: keyof Pick<ReviewState, 'therapeuticAreas' | 'modalities' | 'developmentStages' | 'customerTherapeuticAreas' | 'customerModalities' | 'customerDevelopmentStages' | 'companySizes' | 'fundingStages' | 'liFollowerSizes'>) =>
      (value: string) =>
        setReview((prev) => ({
          ...prev,
          [field]: prev[field].includes(value)
            ? prev[field].filter((v) => v !== value)
            : [...prev[field], value],
        }));

  const isReviewValid =
    review.companyType !== '' &&
    (review.therapeuticAreas.length > 0 ||
      review.modalities.length > 0 ||
      review.customerTherapeuticAreas.length > 0 ||
      review.customerModalities.length > 0 ||
      review.developmentStages.length > 0 ||
      review.customerDevelopmentStages.length > 0);

  const handleAnalyse = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setAnalysisError('');
    setPhase('loading');

    const msgs = ['Gathering account intelligence…', 'Verifying funding and headcount…', 'Scanning their LinkedIn…', 'Classifying company type…', 'Mapping to your ICP…', 'Checking recent news…', 'Reviewing their tech stack…', 'Analyzing hiring activity…', 'Estimating revenue range…', 'Almost there…'];
    let mi = 0;
    setLoadingMsg(msgs[0]);
    const interval = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 2500);

    try {
      const res = await fetch('/api/analyze-example-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      clearInterval(interval);

      if (!res.ok) throw new Error('Analysis failed');
      const data = (await res.json()) as TargetCompanyEnrichmentResult;
      setEnrichmentSnapshot(data);

      const detectedName =
        data.company_name ??
        normalized.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
      setCompanyName(detectedName);

      const sizes = employeeCountToSizeBucket(data.employee_count, data.employee_range ?? null);
      const liSizes = followerCountToFollowerBucket(data.follower_count);

      setReview({
        companyName: detectedName,
        companyType: data.company_type ?? '',
        therapeuticAreas: data.therapeutic_areas ?? [],
        modalities: data.modalities ?? [],
        developmentStages: data.development_stages ?? [],
        customerTherapeuticAreas: data.customer_therapeutic_areas ?? [],
        customerModalities: data.customer_modalities ?? [],
        customerDevelopmentStages: data.customer_development_stages ?? [],
        companySizes: sizes,
        fundingStages: (() => { const s = canonicalizeFundingStage(data.funding_stage, data.total_funding_usd); return s ? [s] : []; })(),
        liFollowerSizes: liSizes,
      });

      setPhase('review');
    } catch {
      clearInterval(interval);
      setAnalysisError("Couldn't analyse that URL — check it's correct and try again.");
      setPhase('url-input');
    }
  };

  const handleSave = async () => {
    if (!enrichmentSnapshot?.website?.trim()) {
      setPhase('review');
      return;
    }

    setPhase('saving');

    const nameRes = await fetch('/api/generate-icp-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyType: review.companyType,
        therapeuticAreas: review.therapeuticAreas,
        modalities: review.modalities,
        developmentStages: review.developmentStages,
        customerTherapeuticAreas: review.customerTherapeuticAreas,
        customerModalities: review.customerModalities,
        customerDevelopmentStages: review.customerDevelopmentStages,
        companySizes: review.companySizes,
        fundingStages: review.fundingStages,
        exampleCompanyName: review.companyName,
        exampleCompanyDescription: enrichmentSnapshot.description ?? undefined,
      }),
    });
    const { name } = nameRes.ok ? await nameRes.json() as { name: string } : { name: `${review.companyType} Profile` };

    const saveRes = await fetch('/api/company-criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        companyType: review.companyType,
        therapeuticAreas: review.therapeuticAreas,
        modalities: review.modalities,
        developmentStages: review.developmentStages,
        customerTherapeuticAreas: review.customerTherapeuticAreas,
        customerModalities: review.customerModalities,
        customerDevelopmentStages: review.customerDevelopmentStages,
        companySizes: review.companySizes,
        liFollowerSizes: review.liFollowerSizes,
        fundingStages: review.fundingStages,
        signals: [],
        exampleCompanies: [],
        exampleCompanyUrl: enrichmentSnapshot.website,
        exampleCompanyEnrichment: enrichmentSnapshot,
      }),
    });

    if (!saveRes.ok) {
      setPhase('review');
      return;
    }

    onComplete();
  };

  // ── URL input ────────────────────────────────────────────────────────────

  if (phase === 'url-input') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm text-gray-600">
            Enter the website of a company that represents your ideal customer. We'll analyse it and pre-fill your ICP — you can adjust anything before saving.
          </p>
        </div>
        <form onSubmit={handleAnalyse} className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="e.g. bioora.com"
            className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-arcova-teal"
            autoFocus
          />
          <button
            type="submit"
            disabled={!urlInput.trim()}
            className="rounded-xl bg-arcova-teal px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-30"
          >
            Analyse →
          </button>
        </form>
        {analysisError && (
          <p className="text-sm text-red-600">{analysisError}</p>
        )}
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div className="flex items-center gap-3 py-6">
        <div className="flex gap-1">
          {[0, 150, 300].map((d) => (
            <div key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/70" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <span className="text-sm text-gray-600">{loadingMsg}</span>
      </div>
    );
  }

  // ── Saving ───────────────────────────────────────────────────────────────

  if (phase === 'saving') {
    return (
      <div className="flex items-center gap-3 py-6">
        <div className="flex gap-1">
          {[0, 150, 300].map((d) => (
            <div key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/70" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <span className="text-sm text-gray-600">Saving your ICP…</span>
      </div>
    );
  }

  // ── Review ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-600">
          Based on <span className="font-medium text-gray-800">{companyName}</span>. Adjust the selections below to match the broader category of companies you target.
        </p>
      </div>

      <div className="space-y-5">
        <Field label="Company type">
          <SingleChipGrid
            options={COMPANY_TYPE_OPTIONS}
            selected={review.companyType}
            onSelect={(v) => setReview((p) => ({ ...p, companyType: v }))}
            emptyPrompt="Select the type that best matches your target accounts"
          />
        </Field>

        <Field label="Therapeutic areas">
          <MultiChipGrid
            options={THERAPEUTIC_AREA_OPTIONS}
            selected={review.therapeuticAreas}
            onToggle={toggle('therapeuticAreas')}
            emptyPrompt="Select at least one therapeutic area"
          />
        </Field>

        <Field label="Modalities">
          <MultiChipGrid
            options={MODALITY_OPTIONS}
            selected={review.modalities}
            onToggle={toggle('modalities')}
            emptyPrompt="Select at least one modality"
          />
        </Field>

        <Field label="Development stage">
          <MultiChipGrid
            options={DEVELOPMENT_STAGE_OPTIONS}
            selected={review.developmentStages}
            onToggle={toggle('developmentStages')}
            emptyPrompt="Select applicable development stages"
          />
        </Field>

        <Field label="Company size">
          <MultiChipGrid
            options={COMPANY_SIZE_OPTIONS}
            selected={review.companySizes}
            onToggle={toggle('companySizes')}
            emptyPrompt="Select typical company sizes"
          />
        </Field>

        <Field label="LinkedIn follower base">
          <MultiChipGrid
            options={LI_FOLLOWER_OPTIONS}
            selected={review.liFollowerSizes}
            onToggle={toggle('liFollowerSizes')}
            emptyPrompt="Select typical follower scales"
          />
        </Field>

        <Field label="Funding stage">
          <MultiChipGrid
            options={FUNDING_STAGE_OPTIONS}
            selected={review.fundingStages}
            onToggle={toggle('fundingStages')}
            emptyPrompt="Select typical funding stages"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => {
            setUrlInput('');
            setEnrichmentSnapshot(null);
            setPhase('url-input');
          }}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Try a different URL
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isReviewValid}
          className="rounded-xl bg-arcova-teal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-30"
        >
          Save ICP →
        </button>
      </div>

      {!isReviewValid && (
        <p className="text-xs text-amber-600">
          Company type, at least one therapeutic area, and at least one modality are required.
        </p>
      )}
    </div>
  );
}
