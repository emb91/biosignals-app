'use client';

/**
 * AccountEditDialog — per-user override editor for an enriched account.
 *
 * Edits are stored in user_companies.user_overrides (JSONB) and never touch
 * the shared canonical companies row. Reads via accounts_view COALESCE the
 * user's override over the canonical value. Clearing a field removes the
 * override and the canonical value resurfaces.
 *
 * Categorical fields (company_type, modalities, etc.) use Select / pill
 * multi-select against the taxonomies in lib/arcova-taxonomy so user edits
 * stay aligned with the values ICP scoring expects.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  INDUSTRY_OPTIONS,
  FUNDING_STAGE_OPTIONS,
} from '@/lib/arcova-taxonomy';
import { PLATFORM_CATEGORY_OPTIONS } from '@/lib/platform-category';

type EditableAccount = {
  id: string;
  company_name?: string | null;
  domain?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  description?: string | null;
  bio_summary?: string | null;
  tagline?: string | null;
  industry?: string | null;
  employee_count?: number | null;
  employee_range?: string | null;
  company_size_bucket?: string | null;
  founded_year?: number | null;
  headquarters_city?: string | null;
  headquarters_state?: string | null;
  headquarters_country?: string | null;
  company_type?: string | null;
  clinical_stage?: string | null;
  platform_category?: string | null;
  funding_stage?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
  products_services?: string[] | null;
  services?: string[] | null;
  user_overrides?: Record<string, unknown> | null;
};

type FormState = {
  company_name: string;
  website: string;
  linkedin_url: string;
  description: string;
  bio_summary: string;
  tagline: string;
  industry: string;
  employee_count: string;
  employee_range: string;
  company_size_bucket: string;
  founded_year: string;
  headquarters_city: string;
  headquarters_state: string;
  headquarters_country: string;
  company_type: string;
  clinical_stage: string;
  platform_category: string;
  funding_stage: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  products_services: string;
  services: string;
};

/**
 * Pill fields that have been explicitly reset by the user during this dialog
 * session. PATCH semantics:
 *   - field NOT in resetField, value matches original → no change (skip)
 *   - field NOT in resetField, value differs from original → store array
 *   - field IS in resetField → send null so the server deletes the override
 */
type ResetFlags = Partial<Record<'therapeutic_areas' | 'modalities' | 'development_stages', true>>;

function arr(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? [...value] : [];
}

function csvToArr(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function arrToCsv(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

function buildInitialForm(account: EditableAccount): FormState {
  return {
    company_name: account.company_name ?? '',
    website: account.website ?? '',
    linkedin_url: account.linkedin_url ?? '',
    description: account.description ?? '',
    bio_summary: account.bio_summary ?? '',
    tagline: account.tagline ?? '',
    industry: account.industry ?? '',
    employee_count: account.employee_count != null ? String(account.employee_count) : '',
    employee_range: account.employee_range ?? '',
    company_size_bucket: account.company_size_bucket ?? '',
    founded_year: account.founded_year != null ? String(account.founded_year) : '',
    headquarters_city: account.headquarters_city ?? '',
    headquarters_state: account.headquarters_state ?? '',
    headquarters_country: account.headquarters_country ?? '',
    company_type: account.company_type ?? '',
    clinical_stage: account.clinical_stage ?? '',
    platform_category: account.platform_category ?? '',
    funding_stage: account.funding_stage ?? '',
    therapeutic_areas: arr(account.therapeutic_areas),
    modalities: arr(account.modalities),
    development_stages: arr(account.development_stages),
    products_services: arrToCsv(account.products_services),
    services: arrToCsv(account.services),
  };
}

/**
 * Build the PATCH body: only include fields the user actually changed from
 * the displayed value. Empty strings clear an override (null in payload).
 * For pill-style array fields, the user can explicitly Reset (set to
 * "use enriched") via the resetFlags map — that sends null and the server
 * deletes the override key.
 */
function buildOverridesPayload(
  form: FormState,
  original: FormState,
  resetFlags: ResetFlags,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const stringKeys: Array<keyof FormState> = [
    'company_name', 'website', 'linkedin_url', 'description', 'bio_summary', 'tagline',
    'industry', 'employee_range', 'company_size_bucket',
    'headquarters_city', 'headquarters_state', 'headquarters_country',
    'company_type', 'clinical_stage', 'platform_category', 'funding_stage',
  ];
  for (const key of stringKeys) {
    if (form[key] !== original[key]) {
      overrides[key] = (form[key] as string) === '' ? null : (form[key] as string);
    }
  }
  const numberKeys: Array<keyof FormState> = ['employee_count', 'founded_year'];
  for (const key of numberKeys) {
    if (form[key] !== original[key]) {
      overrides[key] = (form[key] as string) === '' ? null : Number(form[key]);
    }
  }
  // Pill-style arrays
  const arrayKeys: Array<'therapeutic_areas' | 'modalities' | 'development_stages'> = [
    'therapeutic_areas', 'modalities', 'development_stages',
  ];
  for (const key of arrayKeys) {
    if (resetFlags[key]) {
      // Explicit reset: tell the server to delete the override key
      overrides[key] = null;
      continue;
    }
    const next = form[key] as string[];
    const prev = original[key] as string[];
    if (next.length !== prev.length || next.some((v, i) => v !== prev[i])) {
      overrides[key] = next;
    }
  }
  // CSV-style arrays
  const csvArrayKeys: Array<keyof FormState> = ['products_services', 'services'];
  for (const key of csvArrayKeys) {
    if (form[key] !== original[key]) {
      overrides[key] = csvToArr(form[key] as string);
    }
  }
  return overrides;
}

type Props = {
  account: EditableAccount;
  open: boolean;
  onClose: () => void;
  onSaved: (overrides: Record<string, unknown>) => void;
};

export function AccountEditDialog({ account, open, onClose, onSaved }: Props) {
  const initial = useMemo(() => buildInitialForm(account), [account]);
  const [form, setForm] = useState<FormState>(initial);
  const [resetFlags, setResetFlags] = useState<ResetFlags>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(account));
      setResetFlags({});
      setError(null);
    }
  }, [open, account]);

  if (!open) return null;

  const overrides = account.user_overrides ?? {};
  const overrideKeys = new Set(Object.keys(overrides));

  const setText = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const togglePill = (key: 'therapeutic_areas' | 'modalities' | 'development_stages', option: string) => {
    // Touching pills clears the "reset to enriched" flag for that field.
    setResetFlags((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setForm((prev) => {
      const current = prev[key] as string[];
      const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
      return { ...prev, [key]: next };
    });
  };

  const resetPill = (key: 'therapeutic_areas' | 'modalities' | 'development_stages') => {
    // Mark this field for explicit reset on save (clears the override server-side),
    // and visually empty the pills so the user can see the reset took effect.
    setResetFlags((prev) => ({ ...prev, [key]: true }));
    setForm((prev) => ({ ...prev, [key]: [] }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = buildOverridesPayload(form, initial, resetFlags);
      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      onSaved(json.overrides ?? {});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const labelClass = 'text-xs font-semibold text-gray-600 mb-1 block';
  const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-arcova-teal focus:outline-none focus:ring-1 focus:ring-arcova-teal/40';
  const overrideBadge = (_key: string) => null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit account</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-5">
          {/* ── Identity ────────────────────────────────────────────── */}
          <Section title="Identity">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Company name" badge={overrideBadge('company_name')}>
                <input className={inputClass} value={form.company_name} onChange={setText('company_name')} />
              </Field>
              <Field label="Website" badge={overrideBadge('website')}>
                <input className={inputClass} value={form.website} onChange={setText('website')} placeholder="https://…" />
              </Field>
              <Field label="LinkedIn URL" badge={overrideBadge('linkedin_url')}>
                <input className={inputClass} value={form.linkedin_url} onChange={setText('linkedin_url')} />
              </Field>
              <Field label="Tagline" badge={overrideBadge('tagline')}>
                <input className={inputClass} value={form.tagline} onChange={setText('tagline')} />
              </Field>
              <div className="col-span-2">
                <Field label="Description" badge={overrideBadge('description')}>
                  <textarea className={inputClass} rows={2} value={form.description} onChange={setText('description')} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Bio summary" badge={overrideBadge('bio_summary')}>
                  <textarea className={inputClass} rows={3} value={form.bio_summary} onChange={setText('bio_summary')} />
                </Field>
              </div>
            </div>
          </Section>

          {/* ── Categorisation (drives ICP matching) ────────────────── */}
          <Section title="Categorisation">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Company type" badge={overrideBadge('company_type')}>
                <select className={inputClass} value={form.company_type} onChange={setText('company_type')}>
                  <option value="">—</option>
                  {COMPANY_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} title={opt.description}>
                      {opt.value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Industry" badge={overrideBadge('industry')}>
                <select className={inputClass} value={form.industry} onChange={setText('industry')}>
                  <option value="">—</option>
                  {INDUSTRY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </Field>
              {/* Platform category only applies to SaaS companies. Render the
                  select only when company_type is SaaS — otherwise it's a
                  meaningless field and would just clutter the form. */}
              {form.company_type === 'SaaS' && (
                <Field label="Platform category" badge={overrideBadge('platform_category')}>
                  <select className={inputClass} value={form.platform_category} onChange={setText('platform_category')}>
                    <option value="">—</option>
                    {PLATFORM_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Funding stage" badge={overrideBadge('funding_stage')}>
                <select className={inputClass} value={form.funding_stage} onChange={setText('funding_stage')}>
                  <option value="">—</option>
                  {FUNDING_STAGE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </Field>
            </div>

            <PillField
              label="Therapeutic areas"
              badge={overrideBadge('therapeutic_areas')}
              options={THERAPEUTIC_AREA_OPTIONS as readonly string[]}
              selected={form.therapeutic_areas}
              onToggle={(o) => togglePill('therapeutic_areas', o)}
              canReset={overrideKeys.has('therapeutic_areas')}
              onReset={() => resetPill('therapeutic_areas')}
            />
            <PillField
              label="Modalities"
              badge={overrideBadge('modalities')}
              options={MODALITY_OPTIONS as readonly string[]}
              selected={form.modalities}
              onToggle={(o) => togglePill('modalities', o)}
              canReset={overrideKeys.has('modalities')}
              onReset={() => resetPill('modalities')}
            />
            <PillField
              label="Development stages"
              badge={overrideBadge('development_stages')}
              options={DEVELOPMENT_STAGE_OPTIONS as readonly string[]}
              selected={form.development_stages}
              onToggle={(o) => togglePill('development_stages', o)}
              canReset={overrideKeys.has('development_stages')}
              onReset={() => resetPill('development_stages')}
            />
          </Section>

          {/* ── Firmographics ───────────────────────────────────────── */}
          <Section title="Firmographics">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Employee count (number)" badge={overrideBadge('employee_count')}>
                <input className={inputClass} type="number" value={form.employee_count} onChange={setText('employee_count')} />
              </Field>
              <Field label="Employee range (bucket)" badge={overrideBadge('employee_range')}>
                <select className={inputClass} value={form.employee_range} onChange={setText('employee_range')}>
                  <option value="">—</option>
                  {COMPANY_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </Field>
              <Field label="Company size bucket" badge={overrideBadge('company_size_bucket')}>
                <select className={inputClass} value={form.company_size_bucket} onChange={setText('company_size_bucket')}>
                  <option value="">—</option>
                  {COMPANY_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </Field>
              <Field label="Founded year" badge={overrideBadge('founded_year')}>
                <input className={inputClass} type="number" value={form.founded_year} onChange={setText('founded_year')} />
              </Field>
              <Field label="HQ city" badge={overrideBadge('headquarters_city')}>
                <input className={inputClass} value={form.headquarters_city} onChange={setText('headquarters_city')} />
              </Field>
              <Field label="HQ state" badge={overrideBadge('headquarters_state')}>
                <input className={inputClass} value={form.headquarters_state} onChange={setText('headquarters_state')} />
              </Field>
              <div className="col-span-2">
                <Field label="HQ country" badge={overrideBadge('headquarters_country')}>
                  <input className={inputClass} value={form.headquarters_country} onChange={setText('headquarters_country')} />
                </Field>
              </div>
            </div>
          </Section>

          {/* ── Free-text arrays ────────────────────────────────────── */}
          <Section title="Products & services" subtitle="Comma-separated.">
            <Field label="Products / services" badge={overrideBadge('products_services')}>
              <input className={inputClass} value={form.products_services} onChange={setText('products_services')} />
            </Field>
            <Field label="Services" badge={overrideBadge('services')}>
              <input className={inputClass} value={form.services} onChange={setText('services')} />
            </Field>
          </Section>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-arcova-teal text-white text-sm font-semibold hover:bg-arcova-teal/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save edits
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-gray-100 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, badge, children }: { label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label}
        {badge}
      </label>
      {children}
    </div>
  );
}

function PillField({
  label,
  badge,
  options,
  selected,
  onToggle,
  canReset,
  onReset,
}: {
  label: string;
  badge?: React.ReactNode;
  options: readonly string[];
  selected: string[];
  onToggle: (option: string) => void;
  canReset?: boolean;
  onReset?: () => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-gray-600 block">
          {label}
          {badge}
          {selected.length > 0 && (
            <span className="ml-2 text-[10px] font-normal text-gray-400">{selected.length} selected</span>
          )}
        </label>
        {canReset && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-gray-500 hover:text-arcova-teal transition-colors underline-offset-2 hover:underline"
            title="Remove your override; use the value from enrichment"
          >
            Reset to enriched
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selectedSet.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={
                active
                  ? 'inline-flex items-center rounded-full bg-arcova-teal text-white px-2.5 py-1 text-xs font-medium hover:bg-arcova-teal/90 transition-colors'
                  : 'inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2.5 py-1 text-xs font-medium hover:bg-gray-200 transition-colors'
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
