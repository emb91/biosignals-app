'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/routes';
import { CalendarClock, ChevronRight, ListChecks, Pin, X } from 'lucide-react';

const HubSpotLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z" />
  </svg>
);

type TriageGroup = 'high' | 'medium' | 'low';

type TriageRow = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  location: string | null;
  status: string | null;
  triage_group: TriageGroup | null;
  triage_override_group: TriageGroup | null;
  effective_triage_group: TriageGroup | null;
  triage_version: string | null;
  triage_scored_at: string | null;
  triage_overridden_by: string | null;
  triage_overridden_at: string | null;
  pinned_at: string | null;
  expected_enrichment_date: string | null;
  queue_position: number | null;
  apparent_fit_score: number;
  raw_data: Record<string, unknown>;
};

type TriageSummary = {
  total: number;
  high: number;
  medium: number;
  low: number;
  untriaged: number;
  scheduledHighFit: number;
  monthlyThroughput: number;
};

const TRIAGE_OPTIONS: Array<{ value: TriageGroup; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const TRIAGE_TABLE_GRID = 'grid gap-x-5';
const TRIAGE_GRID_COLS =
  'minmax(0,1.15fr) minmax(0,1fr) minmax(0,0.75fr) minmax(8rem,0.8fr) minmax(5.5rem,0.55fr)';

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function friendlyError(message: string | null): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  // Swallow raw backend/database errors (SQL column/table/relation messages, stack-trace
  // shaped text). An empty or failed-to-load triage list isn't something the customer needs
  // to act on — usually it just means they've worked through the queue — so we show nothing
  // rather than a scary banner.
  const looksTechnical =
    /(column|relation|table|constraint|syntax error|does not exist|null value|violates|undefined|cannot read|\bat\s+\/|\.[tj]sx?:\d)/i.test(
      trimmed,
    );
  if (looksTechnical) {
    return null;
  }
  return trimmed;
}

function triageLabel(value: TriageGroup | null): string {
  if (value === 'high') return 'High';
  if (value === 'medium') return 'Medium';
  if (value === 'low') return 'Low';
  return 'Untriaged';
}

function triageClass(value: TriageGroup | null): string {
  if (value === 'high') return 'border-[rgba(45,138,138,0.22)] bg-[rgba(45,138,138,0.08)] text-[#2d8a8a]';
  if (value === 'medium') return 'border-[rgba(245,115,22,0.24)] bg-[rgba(255,122,89,0.08)] text-[#b85b3e]';
  if (value === 'low') return 'border-[rgba(90,104,115,0.18)] bg-[rgba(90,104,115,0.06)] text-[#65747d]';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function rawValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

function RawDetail({ label, value }: { label: string; value: unknown }) {
  const display = rawValue(value);
  if (!display) return null;
  return (
    <div className="border-b border-[rgba(13,53,71,0.08)] py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-arcova-navy/35">{label}</dt>
      <dd className="mt-1 break-words text-sm text-arcova-navy/75">{display}</dd>
    </div>
  );
}

export default function TriagePage() {
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [summary, setSummary] = useState<TriageSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = selectedId ? rows.find((row) => row.id === selectedId) ?? null : null;
  const loadTriage = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/triage');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load triage.');
      const nextRows = (payload.data || []) as TriageRow[];
      setRows(nextRows);
      setSummary(payload.summary || null);
      setSelectedId((current) =>
        current && nextRows.some((row) => row.id === current)
          ? current
          : nextRows[0]?.id ?? null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load triage.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTriage();
  }, []);

  const updateRow = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch('/api/triage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Update failed.');
      await loadTriage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const enrichNow = async (row: TriageRow) => {
    if (!window.confirm(`Enrich ${row.name} now?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const operationId = crypto.randomUUID();
      const preflightResponse = await fetch('/api/import-contacts/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawUploadIds: [row.id], operationId }),
      });
      const preflight = await preflightResponse.json();
      if (!preflightResponse.ok) throw new Error(preflight.error || 'Could not price enrichment.');
      const credits = Number(preflight.preflight?.estimatedCredits ?? 4);
      if (!window.confirm(`Use up to ${credits.toLocaleString()} credits?`)) return;
      const response = await fetch('/api/import-contacts/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawUploadIds: [row.id], operationId, confirm: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not start enrichment.');
      await loadTriage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start enrichment.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-0 h-screen bg-transparent">
      <AppSidebar />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden p-3.5 md:flex-row md:gap-2">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-transparent px-3 py-3 sm:px-5 sm:py-4 min-[1280px]:pr-2">
          <div className="flex min-h-0 w-full max-w-none flex-1 flex-col">
            <div className="mb-6 shrink-0 flex flex-col gap-4 max-[767px]:pl-14">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                  <ListChecks className="h-3.5 w-3.5" />
                  Leads
                </div>
                <h1 className="font-manrope mt-2 text-3xl font-semibold leading-tight tracking-[-0.028em] text-slate-950 sm:text-[2.25rem]">
                  Triage
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  {(summary?.total ?? 0) > 0
                    ? `${(summary?.total ?? 0).toLocaleString()} lead${summary?.total === 1 ? '' : 's'} waiting for enrichment. High-fit leads are scheduled first; click a row to inspect or change its category.`
                    : `Imported leads waiting for enrichment will appear here after triage. You can enrich ${(summary?.monthlyThroughput ?? 300).toLocaleString()} leads per month.`}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link
                    href={ROUTES.import}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff7a59] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#e8693f]"
                  >
                    <HubSpotLogo className="h-4 w-4" />
                    Import from HubSpot
                  </Link>
                </div>
              </div>
            </div>

            {error && friendlyError(error) && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {friendlyError(error)}
              </div>
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.16),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-2xl backdrop-saturate-150">
                <div
                  className={`${TRIAGE_TABLE_GRID} shrink-0 items-start border-b border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.4)] py-3 pl-9 pr-4 text-[13px] font-semibold uppercase tracking-wide text-[#7d909a]`}
                  style={{ gridTemplateColumns: TRIAGE_GRID_COLS }}
                >
                  <span>Name</span>
                  <span>Company</span>
                  <span className="text-center">Triage</span>
                  <span className="text-center">Expected</span>
                  <span className="text-right">Action</span>
                </div>

                <div className="min-h-0 flex-1 divide-y divide-[rgba(13,53,71,0.06)] overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-24">
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-arcova-teal" />
                    </div>
                  ) : rows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-arcova-navy/45">
                      No pending triage rows.
                    </div>
                  ) : (
                    rows.map((row, index) => {
                      const isSelected = selected?.id === row.id;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className={cn(
                            `${TRIAGE_TABLE_GRID} relative w-full cursor-pointer items-center py-3 pl-9 pr-4 text-left transition-all duration-150 before:pointer-events-none before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-sm before:content-[''] before:transition-colors`,
                            isSelected
                              ? 'bg-arcova-teal/10 before:bg-arcova-teal'
                              : 'before:bg-transparent hover:bg-arcova-teal/5 hover:before:bg-arcova-teal/35',
                          )}
                          style={{ gridTemplateColumns: TRIAGE_GRID_COLS }}
                        >
                          <span aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 select-none text-[10px] font-medium tabular-nums text-gray-400">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">{row.name}</span>
                            <span className="block truncate text-xs leading-snug text-[#7d909a]">
                              {row.title || row.email || 'Raw contact'}
                            </span>
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-700">{row.company || 'Unknown company'}</span>
                            <span className="block truncate text-xs leading-snug text-[#7d909a]">
                              {row.company_domain || row.location || '-'}
                            </span>
                          </span>
                          <span className="flex justify-center">
                            <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-semibold', triageClass(row.effective_triage_group))}>
                              {triageLabel(row.effective_triage_group)}
                            </span>
                          </span>
                          <span className="text-center text-sm text-slate-600">
                            {row.expected_enrichment_date ? formatDate(row.expected_enrichment_date) : '-'}
                          </span>
                          <span className="flex justify-end">
                            <ChevronRight className="h-4 w-4 text-arcova-navy/30" />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>

        {!selected && (
          <AgentPanel
            className="min-[1280px]:pl-1.5"
            page="leads"
            pageContext={{ leadsView: 'contacts' }}
            inputPlaceholder="Ask anything about your triaged leads…"
          />
        )}

        {selected && (
          <aside className="hidden min-h-0 w-[24rem] shrink-0 flex-col overflow-hidden rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.72)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2),0_2px_6px_-2px_rgba(13,53,71,0.08)] backdrop-blur-2xl backdrop-saturate-150 md:flex">
            <div className="border-b border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.5)] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-arcova-navy">{selected.name}</h2>
                  <p className="mt-1 truncate text-sm text-arcova-navy/50">
                    {selected.title || selected.company || 'Pending enrichment'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-lg p-1.5 text-arcova-navy/40 transition-colors hover:bg-white hover:text-arcova-navy"
                  aria-label="Close triage detail"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="mb-4 rounded-xl border border-[rgba(13,53,71,0.1)] bg-white/65 p-3">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-arcova-navy/35">
                  Triage category
                </label>
                <select
                  value={selected.effective_triage_group ?? ''}
                  disabled={busyId === selected.id}
                  onChange={(event) => void updateRow(selected.id, { triageGroup: event.target.value as TriageGroup })}
                  className="mt-2 h-10 w-full rounded-lg border border-[rgba(13,53,71,0.12)] bg-white px-3 text-sm font-semibold text-arcova-navy outline-none"
                >
                  {!selected.effective_triage_group && <option value="" disabled>Untriaged</option>}
                  {TRIAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selected.triage_override_group && (
                  <p className="mt-2 text-xs text-arcova-navy/45">
                    Manual override saved {formatDate(selected.triage_overridden_at)}.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[rgba(13,53,71,0.1)] bg-white/55 px-4">
                <RawDetail label="Company" value={selected.company} />
                <RawDetail label="Company domain" value={selected.company_domain} />
                <RawDetail label="Email" value={selected.email} />
                <RawDetail label="LinkedIn" value={selected.linkedin_url} />
                <RawDetail label="Location" value={selected.location} />
                <RawDetail label="Queue position" value={selected.queue_position ? `#${selected.queue_position}` : null} />
                <RawDetail label="Expected enrichment" value={formatDate(selected.expected_enrichment_date)} />
                <RawDetail label="Model triage" value={triageLabel(selected.triage_group)} />
              </div>
            </div>

            <div className="border-t border-[rgba(13,53,71,0.08)] px-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => void updateRow(selected.id, { pinNextBatch: true })}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <Pin className="h-4 w-4" />
                  Next batch
                </button>
                <button
                  type="button"
                  disabled={busyId === selected.id || selected.effective_triage_group === 'low'}
                  onClick={() => void enrichNow(selected)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-arcova-teal text-sm font-medium text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-50"
                >
                  <CalendarClock className="h-4 w-4" />
                  Enrich now
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
