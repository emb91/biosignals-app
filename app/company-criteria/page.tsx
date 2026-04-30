'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast } from 'sonner';
import {
  Briefcase,
  Users,
  Building2,
  ExternalLink,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { getSignalDisplayName } from '@/lib/signal-display-names';
import { parseSSEStream } from '@/lib/sse';
import {
  extractFundingStatus,
  extractFundingRaised,
  formatCurrencyShort,
} from '@/lib/funding-display';
import { splitCustomerSegments } from '@/lib/split-customer-segments';
import type { CompetitorItem } from '@/components/SetupProfilePanel';
import {
  BUSINESS_AREA_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  LI_FOLLOWER_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
} from '@/lib/arcova-taxonomy';

// ── Types ──────────────────────────────────────────────────────────────────

interface ExampleEnrichment {
  company_name?: string | null;
  website?: string | null;
  logo_url?: string | null;
  tagline?: string | null;
  description?: string[] | null;
  customers_we_serve?: string[] | null;
  value_propositions?: string[] | null;
  competitors_enriched?: { name: string; url?: string }[] | null;
  employee_count?: number | null;
  employee_range?: string | null;
  hq_city?: string | null;
  hq_country?: string | null;
  company_status?: string | null;
  funding_stage?: string | null;
  total_funding_usd?: number | null;
  linkedin_url?: string | null;
  follower_count?: number | null;
}

interface ICP {
  id: string;
  name: string;
  icp_summary?: string | null;
  company_type: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  /** Beachhead: customer disease focus (who they sell into) */
  customer_therapeutic_areas?: string[];
  customer_modalities?: string[];
  customer_development_stages?: string[];
  company_sizes: string[];
  li_follower_sizes: string[];
  funding_stages: string[];
  signals: string[];
  example_company_url: string;
  example_company_enrichment?: ExampleEnrichment | null;
  created_at: string;
  updated_at?: string;
}

interface Persona {
  id: string;
  name: string;
  functions: string[];
  seniority_levels: string[];
  icp_id: string | null;
  job_titles?: string[];
  signals?: string[];
}

// ── Primitive helpers (same visual language as SetupProfilePanel) ──────────

function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-arcova-teal/15 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-arcova-teal/50 hover:text-arcova-teal transition-colors">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function AddTagSelect({ options, selected, onAdd, placeholder = 'Add…' }: {
  options: string[];
  selected: string[];
  onAdd: (v: string) => void;
  placeholder?: string;
}) {
  const remaining = options.filter((o) => !selected.includes(o));
  if (!remaining.length) return null;
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
      className="mt-1 w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/40 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {remaining.map((o) => (
        <option key={o} value={o} className="bg-slate-900 text-white">{o}</option>
      ))}
    </select>
  );
}

function FieldRow({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs text-white/40">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t) => <Tag key={t} label={t} />)}
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-white/70 leading-snug">
          <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div>
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-0.5 text-sm text-white/80 leading-tight">{value}</p>
      {subValue && <p className="text-xs text-white/50 leading-tight">{subValue}</p>}
    </div>
  );
}

/** Collapsible segment — matches SubSection in SetupProfilePanel exactly */
function Segment({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl overflow-hidden transition-colors ${
      open ? 'border border-white/10 bg-white/[0.06]' : 'bg-white/[0.18] hover:bg-white/[0.22]'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      >
        <span className={`text-xs font-semibold ${open ? 'text-white/60' : 'text-white'}`}>{label}</span>
        {open
          ? <ChevronUp className="h-3 w-3 text-white/60 shrink-0" />
          : <ChevronDown className="h-3 w-3 text-white shrink-0" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function parseFunctionName(f: string): string {
  try { return (JSON.parse(f) as { name?: string }).name ?? f; } catch { return f; }
}


async function fetchIcpSummary(icp: ICP): Promise<string> {
  const e = icp.example_company_enrichment;
  const res = await fetch('/api/generate-icp-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyType: icp.company_type,
      therapeuticAreas: icp.therapeutic_areas,
      modalities: icp.modalities,
      developmentStages: icp.development_stages,
      customerTherapeuticAreas: icp.customer_therapeutic_areas ?? [],
      customerModalities: icp.customer_modalities ?? [],
      customerDevelopmentStages: icp.customer_development_stages ?? [],
      fundingStages: icp.funding_stages,
      companySizes: icp.company_sizes,
      exampleCompanyName: e?.company_name ?? null,
      exampleCompanyDescription: e?.description ?? null,
    }),
  });
  if (!res.ok) return '';
  const { summary } = await res.json();
  return summary ?? '';
}

// ── Inline edit: removable tags + add dropdown ────────────────────────────

function EditTagField({
  label,
  options,
  selected,
  onRemove,
  onAdd,
  placeholder = 'Add…',
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onRemove: (v: string) => void;
  onAdd: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-white/40">{label}</p>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map((v) => (
            <Tag key={v} label={v} onRemove={() => onRemove(v)} />
          ))}
        </div>
      )}
      <AddTagSelect options={[...options]} selected={selected} onAdd={onAdd} placeholder={placeholder} />
    </div>
  );
}

// ── Combined ICP + buying team card ───────────────────────────────────────

function ICPCard({
  icp,
  index,
  persona,
  collapsed,
  onToggle,
  onDelete,
  onSaved,
  deleting,
  reenriching,
  onPersonaUpdate,
  onPersonaDelete,
  onAddBuyingTeam,
  onReenrich,
}: {
  icp: ICP;
  index: number;
  persona: Persona | null;
  collapsed: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSaved: (updated: ICP) => void;
  deleting: boolean;
  reenriching: boolean;
  onPersonaUpdate: (p: Persona) => void;
  onPersonaDelete: (id: string) => void;
  onAddBuyingTeam: () => void;
  onReenrich: () => void;
}) {
  const e = icp.example_company_enrichment;
  const domain = e?.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const linkedInDisplay = e?.linkedin_url?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const functions = persona?.functions?.map(parseFunctionName) ?? [];
  const seniority = persona?.seniority_levels ?? [];
  const customerSegments = splitCustomerSegments(e?.customers_we_serve ?? []);

  const [icpSummary, setIcpSummary] = useState<string>('');
  const [summaryLoading, setSummaryLoading] = useState(true);
  useEffect(() => {
    if (typeof icp.icp_summary === 'string' && icp.icp_summary.trim()) {
      setIcpSummary(icp.icp_summary);
      setSummaryLoading(false);
      return;
    }
    let cancelled = false;
    setSummaryLoading(true);
    fetchIcpSummary(icp).then((s) => {
      if (!cancelled) { setIcpSummary(s); setSummaryLoading(false); }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icp.id, icp.company_type, icp.therapeutic_areas.join(), icp.modalities.join()]);

  const hasModelledOnNarrative = Boolean(
    e?.description?.[0] ||
    (e?.customers_we_serve?.length ?? 0) > 0 ||
    (e?.value_propositions?.length ?? 0) > 0 ||
    e?.follower_count != null ||
    e?.linkedin_url
  );

  const hasFirmographics = !!(e?.employee_count != null || e?.employee_range || e?.hq_city || e?.follower_count != null || e?.company_status || e?.total_funding_usd != null || e?.funding_stage);

  const [open, setOpen] = useState({
    criteria: true, firmographics: true, competitors: true, modelledOn: false, functions: true, seniority: true, titles: true,
  });
  const toggle = (key: keyof typeof open) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Unified edit state (covers both criteria and buying team) ────────────
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({
    name: icp.name,
    icp_summary: icp.icp_summary ?? '',
    company_type: icp.company_type,
    therapeutic_areas: [...icp.therapeutic_areas],
    modalities: [...icp.modalities],
    development_stages: [...icp.development_stages],
    customer_therapeutic_areas: [...(icp.customer_therapeutic_areas ?? [])],
    customer_modalities: [...(icp.customer_modalities ?? [])],
    customer_development_stages: [...(icp.customer_development_stages ?? [])],
    company_sizes: [...icp.company_sizes],
    li_follower_sizes: [...(icp.li_follower_sizes ?? [])],
    funding_stages: [...icp.funding_stages],
  });
  const [editFunctions, setEditFunctions] = useState<string[]>([]);
  const [editSeniority, setEditSeniority] = useState<string[]>([]);
  const [editCompetitors, setEditCompetitors] = useState<CompetitorItem[]>([]);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const hasCompetitors = editMode || (e?.competitors_enriched?.length ?? 0) > 0;

  const startEdit = () => {
    setEditData({
      name: icp.name,
      icp_summary: icp.icp_summary ?? icpSummary,
      company_type: icp.company_type,
      therapeutic_areas: [...icp.therapeutic_areas],
      modalities: [...icp.modalities],
      development_stages: [...icp.development_stages],
      customer_therapeutic_areas: [...(icp.customer_therapeutic_areas ?? [])],
      customer_modalities: [...(icp.customer_modalities ?? [])],
      customer_development_stages: [...(icp.customer_development_stages ?? [])],
      company_sizes: [...icp.company_sizes],
      li_follower_sizes: [...(icp.li_follower_sizes ?? [])],
      funding_stages: [...icp.funding_stages],
    });
    setEditFunctions([...functions]);
    setEditSeniority([...seniority]);
    setEditCompetitors([...(icp.example_company_enrichment?.competitors_enriched ?? [])]);
    setNewCompetitorUrl('');
    setEditMode(true);
    if (collapsed) onToggle();
  };

  const cancelEdit = () => {
    setEditFunctions([...functions]);
    setEditSeniority([...seniority]);
    setEditCompetitors([...(icp.example_company_enrichment?.competitors_enriched ?? [])]);
    setNewCompetitorUrl('');
    setEditMode(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const icpRes = await fetch(`/api/company-criteria/${icp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editData.name,
          icpSummary: editData.icp_summary,
          companyType: editData.company_type,
          therapeuticAreas: editData.therapeutic_areas,
          modalities: editData.modalities,
          developmentStages: editData.development_stages,
          customerTherapeuticAreas: editData.customer_therapeutic_areas,
          customerModalities: editData.customer_modalities,
          customerDevelopmentStages: editData.customer_development_stages,
          companySizes: editData.company_sizes,
          liFollowerSizes: editData.li_follower_sizes,
          fundingStages: editData.funding_stages,
          signals: icp.signals ?? [],
          exampleCompanies: [],
          exampleCompanyUrl: icp.example_company_url,
          exampleCompanyEnrichment:
            icp.example_company_enrichment == null
              ? null
              : {
                  ...icp.example_company_enrichment,
                  competitors_enriched: editCompetitors.length > 0 ? editCompetitors : null,
                },
        }),
      });

      if (!icpRes.ok) {
        const errorPayload = await icpRes.json().catch(() => null) as { error?: string } | null;
        const message = errorPayload?.error ?? 'Failed to save ICP';
        if (message.includes('icp_summary')) {
          toast.error('`icp_summary` is missing in the database. Apply the latest Supabase migration, then try again.');
        } else {
          toast.error(message);
        }
        return;
      }

      const result = await icpRes.json();
      onSaved(result.data ?? { ...icp, ...editData });
      setIcpSummary(editData.icp_summary);

      if (persona) {
        const teamRes = await fetch(`/api/contacts/${persona.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: persona.name,
            functions: editFunctions,
            seniorityLevels: editSeniority,
            jobTitles: persona.job_titles ?? [],
            signals: persona.signals ?? [],
          }),
        });
        if (teamRes.ok) {
          const { data } = await teamRes.json();
          onPersonaUpdate(data);
        }
      }

      setEditMode(false);
      toast.success('Saved');
    } finally {
      setSaving(false);
    }
  };

  const toggleMulti = (field: keyof typeof editData, value: string) =>
    setEditData((prev) => {
      const arr = prev[field] as string[];
      return { ...prev, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });

  const setSingle = (field: keyof typeof editData, value: string) =>
    setEditData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.06]">

      {/* Card header */}
      <div className={`flex items-center gap-2.5 px-4 py-3 ${!collapsed ? 'border-b border-white/10' : ''}`}>
        {editMode ? (
          <>
            <Briefcase className="h-4 w-4 shrink-0 text-arcova-teal" />
            <input
              value={editData.name}
              onChange={(e) => setEditData((prev) => ({ ...prev, name: e.target.value }))}
              className="flex-1 min-w-0 rounded-lg bg-white/[0.08] border border-white/20 px-2.5 py-1 text-sm font-semibold text-white placeholder-white/30 focus:outline-none focus:border-arcova-teal/60"
              placeholder="Profile name"
            />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className="flex flex-1 items-center gap-2.5 text-left min-w-0"
            >
              <Briefcase className="h-4 w-4 shrink-0 text-arcova-teal" />
              <span className="flex-1 text-sm font-semibold text-white truncate">
                ICP {index}: {icp.name || 'ICP Profile'}
              </span>
              {collapsed
                ? <ChevronDown className="h-4 w-4 text-white/40 shrink-0" />
                : <ChevronUp className="h-4 w-4 text-white/40 shrink-0" />}
            </button>
          </>
        )}
      </div>


      {/* Two-column body */}
      {!collapsed && <div className="flex divide-x divide-white/10">

        {/* Left column — firmographics */}
        <div className="flex-1 min-w-0 px-4 py-4 space-y-2">

          {editMode ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 space-y-1.5">
              <p className="text-xs text-white/40">ICP summary</p>
              <textarea
                value={editData.icp_summary}
                onChange={(e) => setEditData((prev) => ({ ...prev, icp_summary: e.target.value }))}
                rows={3}
                className="w-full rounded-lg bg-white/[0.08] border border-white/20 px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-arcova-teal/60 resize-y"
                placeholder="Write a short summary of this ICP..."
              />
            </div>
          ) : (summaryLoading || icpSummary.length > 0) && (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 space-y-1.5">
              <p className="text-xs text-white/40">ICP summary</p>
              {summaryLoading ? (
                <div className="h-3 w-3/4 rounded bg-white/10 animate-pulse" />
              ) : (
                <p className="text-xs text-white/70 leading-snug">{icpSummary}</p>
              )}
            </div>
          )}

          {!editMode && e?.company_name && (
            <Segment label={`Modelled on ${e.company_name}`} open={open.modelledOn} onToggle={() => toggle('modelledOn')}>
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  {e.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.logo_url} alt={e.company_name} className="h-8 w-8 shrink-0 rounded-lg object-contain bg-white/10 p-0.5" />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-white/30" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white leading-tight">{e.company_name}</p>
                    {domain && (
                      <a href={e.website!} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline mt-0.5">
                        {domain}
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    )}
                    {e.tagline && (
                      <p className="mt-1 text-xs italic text-white/40 leading-snug">{e.tagline}</p>
                    )}
                  </div>
                </div>

                {hasModelledOnNarrative && (
                  <div className="space-y-2.5">
                    {e?.description?.[0] && (
                      <p className="text-xs text-white/70 leading-snug">{e.description[0]}</p>
                    )}

                    {(customerSegments.customerOrganizations.length > 0 || customerSegments.buyerTypes.length > 0) && (
                      <div className="space-y-2">
                        <FieldRow label="Customer organisations" items={customerSegments.customerOrganizations} />
                        <FieldRow label="Buyer / user types" items={customerSegments.buyerTypes} />
                      </div>
                    )}

                    {(e?.value_propositions?.length ?? 0) > 0 && (
                      <div>
                        <p className="mb-1 text-xs text-white/35">Value props</p>
                        <BulletList items={e.value_propositions!.slice(0, 3)} />
                      </div>
                    )}

                    {(e?.follower_count != null || linkedInDisplay) && (
                      <div className="space-y-1">
                        {e?.follower_count != null && (
                          <Stat label="LinkedIn followers" value={e.follower_count.toLocaleString()} />
                        )}
                        {linkedInDisplay && (
                          <a href={e.linkedin_url!} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline break-all">
                            {linkedInDisplay}
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Segment>
          )}

          {/* Criteria segment — matches setup panel ICP taxonomy + funding raised tag */}
          <Segment label="Criteria" open={open.criteria} onToggle={() => toggle('criteria')}>
            {editMode ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs text-white/40">Company type</p>
                  {editData.company_type ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Tag label={editData.company_type} onRemove={() => setSingle('company_type', '')} />
                    </div>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) setSingle('company_type', e.target.value); }}
                      className="w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/40 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
                    >
                      <option value="">Set type…</option>
                      {COMPANY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">{opt.value}</option>
                      ))}
                    </select>
                  )}
                </div>
                <EditTagField label="Therapeutic areas" options={THERAPEUTIC_AREA_OPTIONS} selected={editData.therapeutic_areas} onRemove={(v) => toggleMulti('therapeutic_areas', v)} onAdd={(v) => toggleMulti('therapeutic_areas', v)} />
                <EditTagField label="Modalities" options={MODALITY_OPTIONS} selected={editData.modalities} onRemove={(v) => toggleMulti('modalities', v)} onAdd={(v) => toggleMulti('modalities', v)} />
                <EditTagField label="Development stage" options={DEVELOPMENT_STAGE_OPTIONS} selected={editData.development_stages} onRemove={(v) => toggleMulti('development_stages', v)} onAdd={(v) => toggleMulti('development_stages', v)} />
                <EditTagField label="Company size" options={COMPANY_SIZE_OPTIONS} selected={editData.company_sizes} onRemove={(v) => toggleMulti('company_sizes', v)} onAdd={(v) => toggleMulti('company_sizes', v)} />
                <EditTagField label="LinkedIn follower base" options={LI_FOLLOWER_OPTIONS} selected={editData.li_follower_sizes} onRemove={(v) => toggleMulti('li_follower_sizes', v)} onAdd={(v) => toggleMulti('li_follower_sizes', v)} />
                {e?.company_status && (() => {
                  const fr = extractFundingRaised(e.company_status);
                  return fr ? (
                    <div>
                      <p className="mb-1.5 text-xs text-white/40">Funding raised</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Tag label={fr} />
                      </div>
                    </div>
                  ) : null;
                })()}
                <EditTagField label="Funding stage" options={FUNDING_STAGE_OPTIONS} selected={editData.funding_stages} onRemove={(v) => toggleMulti('funding_stages', v)} onAdd={(v) => toggleMulti('funding_stages', v)} />
              </div>
            ) : (
              <>
                {(icp.company_type || icp.therapeutic_areas.length > 0 || icp.modalities.length > 0) && (
                  <div className="space-y-2.5">
                    {icp.company_type && (
                      <div>
                        <p className="mb-1 text-xs text-white/40">Company type</p>
                        <Tag label={icp.company_type} />
                      </div>
                    )}
                    <FieldRow label="Therapeutic areas" items={icp.therapeutic_areas} />
                    <FieldRow label="Modalities" items={icp.modalities} />
                  </div>
                )}
                {(icp.development_stages.length > 0 || icp.funding_stages.length > 0) && (
                  <div className="space-y-2.5 border-t border-white/10 pt-2">
                    <p className="text-xs text-white/40">Stage and funding</p>
                    <FieldRow label="Development stage" items={icp.development_stages} />
                    <FieldRow label="Funding stage" items={icp.funding_stages} />
                  </div>
                )}
                {((icp.company_sizes.length > 0 || (icp.li_follower_sizes?.length ?? 0) > 0)
                  || !!(e?.company_status && extractFundingRaised(e.company_status))) && (
                  <div className="space-y-2.5 border-t border-white/10 pt-2">
                    <p className="text-xs text-white/40">Scale signals</p>
                    {icp.company_sizes.length > 0 && <FieldRow label="Company size" items={icp.company_sizes} />}
                    {(icp.li_follower_sizes?.length ?? 0) > 0 && (
                      <FieldRow label="LinkedIn follower base" items={icp.li_follower_sizes ?? []} />
                    )}
                    {e?.company_status && (() => {
                      const fr = extractFundingRaised(e.company_status);
                      return fr ? (
                        <div>
                          <p className="mb-1 text-xs text-white/40">Funding raised</p>
                          <div className="flex flex-wrap gap-1.5">
                            <Tag label={fr} />
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
                {icp.signals?.length > 0 && (
                  <div className="space-y-2.5 border-t border-white/10 pt-2">
                    <p className="text-xs text-white/40">Signals</p>
                    <FieldRow label="Signals" items={icp.signals.map((signal) => getSignalDisplayName(signal))} />
                  </div>
                )}
              </>
            )}
          </Segment>

          {hasFirmographics && e && (
            <Segment label="Firmographics" open={open.firmographics} onToggle={() => toggle('firmographics')}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {(e.employee_count != null || e.employee_range) && (
                  <Stat
                    label="Employees"
                    value={e.employee_count != null ? e.employee_count.toLocaleString() : e.employee_range!}
                    subValue={e.employee_count != null && e.employee_range ? e.employee_range : undefined}
                  />
                )}
                {e.hq_city && <Stat label="HQ" value={e.hq_city} subValue={e.hq_country ?? undefined} />}
                {e.follower_count != null && (() => {
                  const band = followerCountToFollowerBucket(e.follower_count);
                  return band[0] ? <Stat label="LinkedIn follower base" value={band[0]} /> : null;
                })()}
                {e.company_status && (() => {
                  const fs = extractFundingStatus(e.company_status);
                  return fs ? <Stat label="Funding status" value={fs} /> : null;
                })()}
                {!e.company_status && e.funding_stage && <Stat label="Funding stage" value={e.funding_stage} />}
                {!e.company_status && e.total_funding_usd != null && e.total_funding_usd > 0 && (
                  <Stat label="Total funding" value={formatCurrencyShort(e.total_funding_usd)} />
                )}
              </div>
              {e.company_status && (
                <div>
                  <p className="text-xs text-white/40 mb-1">Funding summary</p>
                  <p className="text-xs leading-snug text-white/55">{e.company_status}</p>
                </div>
              )}
            </Segment>
          )}

          {hasCompetitors && (
            <Segment label="Competitors" open={open.competitors} onToggle={() => toggle('competitors')}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(editMode ? editCompetitors : (e?.competitors_enriched ?? [])).map((c, i) => {
                    const trimmedUrl = c.url?.trim();
                    const href =
                      trimmedUrl ||
                      `https://www.google.com/search?q=${encodeURIComponent(c.name)}`;
                    return (
                      <span
                        key={`${c.name}-${i}`}
                        className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-arcova-teal/15 pl-2.5 pr-1 py-0.5 text-xs font-medium text-arcova-teal"
                      >
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 max-w-[14rem] items-center gap-0.5 truncate hover:underline"
                          title={c.name}
                        >
                          <span className="truncate">{c.name}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        </a>
                        {editMode && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditCompetitors((prev) => prev.filter((_, j) => j !== i))}
                            className="shrink-0 rounded-full p-0.5 text-arcova-teal/50 transition-colors hover:bg-arcova-teal/20 hover:text-arcova-teal"
                            aria-label={`Remove ${c.name}`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {editMode && (
                  <div className="flex items-center gap-1.5">
                    <span className="mt-0 h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
                    <input
                      type="text"
                      value={newCompetitorUrl}
                      onChange={(ev) => setNewCompetitorUrl(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key !== 'Enter' || !newCompetitorUrl.trim()) return;
                        ev.preventDefault();
                        const raw = newCompetitorUrl.trim();
                        let url = raw;
                        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                        let name = raw;
                        try {
                          name = new URL(url).hostname.replace(/^www\./, '');
                        } catch { /* keep raw as label */ }
                        setEditCompetitors((prev) => [...prev, { name, url }]);
                        setNewCompetitorUrl('');
                      }}
                      placeholder="Paste competitor URL… (Enter)"
                      className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-arcova-teal/50"
                    />
                  </div>
                )}
              </div>
            </Segment>
          )}

        </div>

        {/* Right column — buying team */}
        <div className="w-80 shrink-0 px-4 py-4 space-y-2">
          <div className="flex items-center gap-1.5 pb-2">
            <Users className="h-3.5 w-3.5 text-arcova-teal shrink-0" />
            <p className="text-sm font-semibold text-white flex-1">Buying team</p>
          </div>

          {editMode ? (
            persona ? (
              <div className="space-y-3">
                <EditTagField
                  label="Functions"
                  options={BUSINESS_AREA_OPTIONS}
                  selected={editFunctions}
                  onRemove={(v) => setEditFunctions((prev) => prev.filter((f) => f !== v))}
                  onAdd={(v) => setEditFunctions((prev) => [...prev, v])}
                />
                <EditTagField
                  label="Seniority"
                  options={SENIORITY_LEVEL_OPTIONS}
                  selected={editSeniority}
                  onRemove={(v) => setEditSeniority((prev) => prev.filter((s) => s !== v))}
                  onAdd={(v) => setEditSeniority((prev) => [...prev, v])}
                />
              </div>
            ) : (
              <p className="text-xs text-white/30 leading-snug pt-1">No buying team defined yet.</p>
            )
          ) : persona ? (
            <>
              <Segment label="Functions" open={open.functions} onToggle={() => toggle('functions')}>
                <div className="flex flex-wrap gap-1.5">
                  {functions.map((f) => <Tag key={f} label={f} />)}
                </div>
              </Segment>
              <Segment label="Seniority" open={open.seniority} onToggle={() => toggle('seniority')}>
                <div className="flex flex-wrap gap-1.5">
                  {seniority.map((s) => <Tag key={s} label={s} />)}
                </div>
              </Segment>
              {(persona?.job_titles?.length ?? 0) > 0 && (
                <Segment label="Example titles" open={open.titles} onToggle={() => toggle('titles')}>
                  <BulletList items={persona!.job_titles!} />
                </Segment>
              )}
            </>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-white/30 leading-snug">No buying team defined yet.</p>
              <button
                type="button"
                onClick={onAddBuyingTeam}
                className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal/40 px-3 py-2 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Add buying team
              </button>
            </div>
          )}
        </div>

      </div>}

      {!collapsed && (
        <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          {editMode ? (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-arcova-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-arcova-teal/85 disabled:opacity-50"
              >
                <Save className="h-3 w-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                className="flex items-center gap-1 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button
                onClick={onReenrich}
                disabled={reenriching}
                className="flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3 w-3 ${reenriching ? 'animate-spin' : ''}`} /> {reenriching ? 'Re-enriching…' : 'Re-enrich'}
              </button>
              <button
                onClick={onDelete}
                disabled={deleting}
                className="flex items-center gap-1 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-400/70 transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ── Page ───────────────────────────────────────────────────────────────────

export default function ICPManagerPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [icps, setIcps] = useState<ICP[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reenrichingId, setReenrichingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [icpRes, personaRes] = await Promise.all([
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
        ]);
        if (icpRes.ok) {
          const result = await icpRes.json();
          const data: ICP[] = result.data || [];
          setIcps(data);
          // Open the first card by default
          if (data.length > 0) setExpandedIds(new Set([data[0].id]));
        }
        if (personaRes.ok) {
          const result = await personaRes.json();
          setPersonas(result.data || []);
        }
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      // Delete any associated buying team persona first
      const linkedPersona = personas.find((p) => p.icp_id === id);
      if (linkedPersona) {
        await fetch(`/api/contacts/${linkedPersona.id}`, { method: 'DELETE' }).catch(() => {});
        setPersonas((prev) => prev.filter((p) => p.id !== linkedPersona.id));
      }

      const res = await fetch(`/api/company-criteria/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setIcps((prev) => prev.filter((icp) => icp.id !== id));
        setExpandedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        toast.success('Company profile deleted');
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleIcpSaved = (updated: ICP) => {
    setIcps((prev) => prev.map((icp) => (icp.id === updated.id ? updated : icp)));
  };

  const handlePersonaUpdate = (updatedPersona: Persona) => {
    setPersonas((prev) => prev.map((persona) => (persona.id === updatedPersona.id ? updatedPersona : persona)));
  };

  const handlePersonaDelete = (deletedPersonaId: string) => {
    setPersonas((prev) => prev.filter((persona) => persona.id !== deletedPersonaId));
  };

  const handleReenrich = async (icp: ICP) => {
    const website = icp.example_company_url;
    if (!website) {
      toast.error('No reference company URL is stored for this ICP');
      return;
    }

    setReenrichingId(icp.id);
    const toastId = `reenrich-${icp.id}`;
    toast.loading('Researching the company…', { id: toastId });
    try {
      const enrichRes = await fetch('/api/analyze-example-company-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: website }),
      });

      if (!enrichRes.ok) {
        throw new Error('Failed to re-enrich reference company');
      }

      type EnrichmentResult = ExampleEnrichment & {
        company_type?: string | null;
        therapeutic_areas?: string[] | null;
        modalities?: string[] | null;
        development_stages?: string[] | null;
        customer_therapeutic_areas?: string[] | null;
        customer_modalities?: string[] | null;
        customer_development_stages?: string[] | null;
      };

      let enrichment: EnrichmentResult | null = null;
      for await (const { event, data } of parseSSEStream(enrichRes)) {
        if (event === 'step_claude') {
          toast.loading('Website analysed ✓  Checking company database…', { id: toastId });
        } else if (event === 'step_apollo') {
          toast.loading('Company data retrieved ✓  Scanning LinkedIn…', { id: toastId });
        } else if (event === 'step_apify') {
          toast.loading('LinkedIn scanned ✓  Classifying company…', { id: toastId });
        } else if (event === 'step_taxonomy') {
          toast.loading('Classified ✓  Finishing up…', { id: toastId });
        } else if (event === 'done') {
          enrichment = data as unknown as EnrichmentResult;
        } else if (event === 'error') {
          throw new Error((data.message as string) || 'Failed to re-enrich reference company');
        }
      }

      if (!enrichment) {
        throw new Error('Failed to re-enrich reference company');
      }

      const summaryRes = await fetch('/api/generate-icp-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyType: enrichment.company_type ?? icp.company_type,
          therapeuticAreas: enrichment.therapeutic_areas ?? icp.therapeutic_areas,
          modalities: enrichment.modalities ?? icp.modalities,
          developmentStages: enrichment.development_stages ?? icp.development_stages,
          customerTherapeuticAreas:
            enrichment.customer_therapeutic_areas ?? icp.customer_therapeutic_areas ?? [],
          customerModalities:
            enrichment.customer_modalities ?? icp.customer_modalities ?? [],
          customerDevelopmentStages:
            enrichment.customer_development_stages ?? icp.customer_development_stages ?? [],
          fundingStages: enrichment.funding_stage ? [enrichment.funding_stage] : icp.funding_stages,
          companySizes:
            enrichment.employee_count != null || enrichment.employee_range
              ? employeeCountToSizeBucket(enrichment.employee_count ?? null, enrichment.employee_range ?? null)
              : icp.company_sizes,
          exampleCompanyName: enrichment.company_name ?? icp.example_company_enrichment?.company_name ?? null,
          exampleCompanyDescription: enrichment.description ?? null,
        }),
      });
      const { summary: icpSummary } = summaryRes.ok ? await summaryRes.json() : { summary: icp.icp_summary ?? '' };

      const employeeCount = enrichment.employee_count ?? null;
      const employeeRange = enrichment.employee_range ?? null;
      const followerCount = enrichment.follower_count ?? null;
      const companySizes =
        employeeCount != null || employeeRange
          ? employeeCountToSizeBucket(employeeCount, employeeRange)
          : icp.company_sizes;
      const liFollowerSizes =
        followerCount != null
          ? followerCountToFollowerBucket(followerCount)
          : icp.li_follower_sizes;

      const updateRes = await fetch(`/api/company-criteria/${icp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: icp.name,
          icpSummary,
          companyType: enrichment.company_type ?? icp.company_type,
          therapeuticAreas: enrichment.therapeutic_areas ?? icp.therapeutic_areas,
          modalities: enrichment.modalities ?? icp.modalities,
          developmentStages: enrichment.development_stages ?? icp.development_stages,
          customerTherapeuticAreas:
            enrichment.customer_therapeutic_areas ?? icp.customer_therapeutic_areas ?? [],
          customerModalities: enrichment.customer_modalities ?? icp.customer_modalities ?? [],
          customerDevelopmentStages:
            enrichment.customer_development_stages ?? icp.customer_development_stages ?? [],
          companySizes,
          liFollowerSizes,
          fundingStages: enrichment.funding_stage ? [enrichment.funding_stage] : icp.funding_stages,
          signals: icp.signals ?? [],
          exampleCompanies: [],
          exampleCompanyUrl: icp.example_company_url,
          exampleCompanyEnrichment: enrichment,
        }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to save refreshed ICP');
      }

      const result = await updateRes.json();
      handleIcpSaved(result.data ?? { ...icp, example_company_enrichment: enrichment });
      toast.success('ICP refreshed', { id: toastId });
    } catch (error) {
      console.error('Failed to re-enrich ICP:', error);
      toast.error('Failed to re-enrich ICP', { id: toastId });
    } finally {
      setReenrichingId(null);
    }
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 to-arcova-darkblue">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gradient-to-b from-slate-950 to-arcova-darkblue">
      <AppSidebar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
            <div className="mx-auto max-w-5xl">

            {/* Page header — same flow as my-profile, no border */}
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">ICP criteria</h1>
                <p className="mt-1 text-sm text-white/40">
                  The types of accounts you sell to, and who buys within them.
                </p>
              </div>
              <button
                onClick={() => router.push('/company-criteria/new')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85 shrink-0"
              >
                <Plus className="h-4 w-4" />
                Add new ICP
              </button>
            </div>

            {icps.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center mb-4">
                  <Building2 className="w-8 h-8 text-white/30" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">No target companies yet</h3>
                <p className="text-white/40 mb-6 text-sm max-w-xs">
                  Add your first target company to define who you sell to and who buys.
                </p>
                <button
                  onClick={() => router.push('/company-criteria/new')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-arcova-teal text-white text-sm font-semibold rounded-lg hover:bg-arcova-teal/85 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add your first company
                </button>
              </div>
            ) : (
              <div className={'space-y-4 [&_.text-xs]:text-[0.9375rem] [&_.text-xs]:leading-normal [&_.text-sm]:text-base [&_.text-sm]:leading-relaxed'}>
                {icps.map((icp, i) => {
                  const persona = personas.find((p) => p.icp_id === icp.id) ?? null;
                  const collapsed = !expandedIds.has(icp.id);
                  return (
                    <ICPCard
                      key={icp.id}
                      icp={icp}
                      index={i + 1}
                      persona={persona}
                      collapsed={collapsed}
                      onToggle={() => setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(icp.id)) next.delete(icp.id);
                        else next.add(icp.id);
                        return next;
                      })}
                      onSaved={handleIcpSaved}
                      onDelete={() => setConfirmDeleteId(icp.id)}
                      deleting={deletingId === icp.id}
                      reenriching={reenrichingId === icp.id}
                      onPersonaUpdate={handlePersonaUpdate}
                      onPersonaDelete={handlePersonaDelete}
                      onAddBuyingTeam={() => router.push(`/personas/new?icpId=${icp.id}`)}
                      onReenrich={() => void handleReenrich(icp)}
                    />
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Delete confirmation modal ── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-icp-modal-title"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <h2 id="delete-icp-modal-title" className="mb-2 text-lg font-semibold text-white">
              Delete this ICP profile?
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-white/55">
              This will permanently remove the target company profile along with its criteria and buying team. Any contacts already found using this profile won&apos;t be affected, but you won&apos;t be able to find new ones with it.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { void handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                disabled={deletingId === confirmDeleteId}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Yes, delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
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
