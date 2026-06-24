'use client';

import { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import '@/app/contacts/contacts-layout.css';

export type CompanyFitComponentKey =
  | 'company_type'
  | 'offering'
  | 'development_stages'
  | 'company_size'
  | 'funding'
  // Legacy keys — kept in the union so breakdowns scored before company_fit_v2
  // (which still carry the old shape until re-scored) don't break rendering.
  | 'platform_category'
  | 'therapeutic_areas'
  | 'modalities';

interface CompanyFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedCount?: number;
  totalSelected?: number;
  matchStatus?: string;
  matchedValues?: string[];
  unmatchedValues?: string[];
}

interface CompanyFitBreakdown {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    score_cap01: number;
    coverage01: number;
    reasoning: string;
  };
  components: Record<CompanyFitComponentKey, CompanyFitBreakdownComponent>;
}

export interface CompanyFitIcpScoreRow {
  icp_id: string;
  icp_name: string | null;
  icp_index: number | null;
  final_score: number | null;
  raw_score: number | null;
  score_cap: number | null;
  coverage: number | null;
  company_type_match_status: string | null;
  breakdown: CompanyFitBreakdown | Record<string, unknown> | null;
}

export interface CompanyFitDetails {
  company_id?: string;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  company_fit_scored_at: string | null;
  company_fit_version: string | null;
  company_fit_summary?: string | null;
  matched_icp_id: string | null;
  matched_icp_name: string | null;
  winning_breakdown: CompanyFitBreakdown | null;
  icp_scores: CompanyFitIcpScoreRow[];
}

const COMPANY_FIT_COMPONENT_ORDER: CompanyFitComponentKey[] = [
  'company_type',
  'offering',
  'development_stages',
  'company_size',
  'funding',
  // Legacy keys last — only render for pre-v2 breakdowns; inactive otherwise.
  'platform_category',
  'therapeutic_areas',
  'modalities',
];

export function formatCompanyFitPercent(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

type FitCriterionOk = 'pass' | 'warn' | 'miss';

function percentDisplayNumberFit(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

function score01ToFitCriterionOk(score01: number): FitCriterionOk {
  if (score01 >= 0.84) return 'pass';
  if (score01 >= 0.45) return 'warn';
  return 'miss';
}

const COMPANY_FIT_PLACEHOLDER_CRITERIA: { ok: FitCriterionOk; text: string; val: string }[] = [
  { ok: 'pass', text: 'Company type vs ICP', val: '✓' },
  { ok: 'pass', text: 'Stage & modality coverage', val: '✓' },
  { ok: 'warn', text: 'Commercial footprint vs target', val: '~' },
];

const getExactCompanyFitPillLabels = (
  key: CompanyFitComponentKey,
  detail: string | null | undefined,
): string[] => {
  if (!detail) return [];

  if (key === 'company_type') {
    const match = detail.match(/^Matches\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'company_size') {
    const match = detail.match(/^Exact size-band match on\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'funding') {
    const labels: string[] = [];
    const stageMatch = detail.match(/Funding stage\s+(.+?)\s+compared with ICP target/i);
    if (stageMatch?.[1]) labels.push(stageMatch[1]);

    const bucketMatch = detail.match(/Raised bucket\s+(.+?)\s+compared with ICP target bucket/i);
    if (bucketMatch?.[1]) labels.push(bucketMatch[1]);

    return labels;
  }

  return [];
};

function renderFitCriterionPills(
  key: CompanyFitComponentKey,
  component: CompanyFitBreakdownComponent,
) {
  const matchPills = component.matchedValues ?? [];
  const missPills = component.unmatchedValues ?? [];
  const hasPills = matchPills.length > 0 || missPills.length > 0;

  return (
    <div className="mt-1.5">
      {matchPills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {matchPills.map((v) => (
            <span
              key={v}
              className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
            >
              {v}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-slate-400">No overlap with ICP.</p>
      )}
    </div>
  );
}

function normalizeBreakdown(row: CompanyFitIcpScoreRow): CompanyFitBreakdown | null {
  const raw = row.breakdown;
  if (!raw || typeof raw !== 'object' || !('components' in raw)) return null;
  return raw as CompanyFitBreakdown;
}

export function CompanyIcpFitDetailPanel({
  details,
  loading,
  error,
  message,
  tableCompanyFitScore,
  tableMatchedIcpLabel,
  embedded = false,
  companyId = null,
}: {
  details: CompanyFitDetails | null;
  loading: boolean;
  error: string | null;
  message: string | null;
  tableCompanyFitScore: number | null;
  tableMatchedIcpLabel: string | null;
  embedded?: boolean;
  companyId?: string | null;
}) {
  const [expandedBars, setExpandedBars] = useState<Set<string>>(new Set());
  const [otherIcpsOpen, setOtherIcpsOpen] = useState(false);

  const toggleBar = useCallback((key: string) => {
    setExpandedBars((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const headerFit = details?.company_fit_score ?? tableCompanyFitScore;
  const displayedFitSummary =
    typeof details?.company_fit_summary === 'string' && details.company_fit_summary.trim()
      ? details.company_fit_summary.trim()
      : null;

  type HeroCritRow = { ok: FitCriterionOk; text: string; val: string; fitKey?: CompanyFitComponentKey };

  const heroCritState: {
    rows: HeroCritRow[];
    icpId: string | null;
    components: CompanyFitBreakdown['components'] | null;
  } = (() => {
    if (loading) return { rows: [], icpId: null, components: null };
    if (details?.icp_scores?.length) {
      const matchedId = details.matched_icp_id;
      const bestScore =
        details.icp_scores.find((s) => s.icp_id === matchedId) ?? details.icp_scores[0];
      const breakdown = normalizeBreakdown(bestScore);
      if (breakdown) {
        const rows: HeroCritRow[] = [];
        for (const key of COMPANY_FIT_COMPONENT_ORDER) {
          const c = breakdown.components[key];
          if (!c?.active) continue;
          rows.push({
            ok: score01ToFitCriterionOk(c.score01),
            text: c.label,
            val: formatCompanyFitPercent(c.score01) ?? '—',
            fitKey: key,
          });
          if (rows.length >= 6) break;
        }
        if (rows.length) return { rows, icpId: bestScore.icp_id, components: breakdown.components };
      }
    }
    if (headerFit != null)
      return { rows: [...COMPANY_FIT_PLACEHOLDER_CRITERIA], icpId: null, components: null };
    return { rows: [], icpId: null, components: null };
  })();

  const heroN = percentDisplayNumberFit(headerFit);

  const heroFitCard = (
    <div className="contacts-fit-card">
      <div className="contacts-fit-head">
        <span className="contacts-fit-head-title">Company fit</span>
        <span className="contacts-fit-head-num">
          {loading ? (
            <span className="text-[13px] font-medium text-[#7d909a]">…</span>
          ) : heroN != null ? (
            <>
              {heroN}
              <span>%</span>
            </>
          ) : (
            <span className="text-[15px] font-semibold text-[#7d909a]">—</span>
          )}
        </span>
      </div>
      <div className="contacts-fit-bar" aria-hidden>
        {!loading && heroN != null ? (
          <span className="contacts-fit-bar-fill" style={{ width: `${Math.min(100, heroN)}%` }} />
        ) : null}
      </div>
      <div className="contacts-fit-criteria">
        {loading ? (
          <p className="text-xs text-[#7d909a]">Loading…</p>
        ) : heroCritState.rows.length ? (
          <>
            {heroCritState.rows.map((row, i) => {
            const component =
              row.fitKey && heroCritState.components ? heroCritState.components[row.fitKey] : null;
            const barKey =
              row.fitKey && heroCritState.icpId ? `icp:${heroCritState.icpId}:${row.fitKey}` : null;
            const isOpen = barKey ? expandedBars.has(barKey) : false;
            const iconClass = [
              'contacts-fit-criterion-icon',
              row.ok === 'pass' ? 'contacts-fit-criterion-pass' : '',
              row.ok === 'warn' ? 'contacts-fit-criterion-warn' : '',
              row.ok === 'miss' ? 'contacts-fit-criterion-miss' : '',
            ]
              .filter(Boolean)
              .join(' ');

            if (!row.fitKey || !component || !barKey) {
              return (
                <div key={`${row.text}-${i}`} className="contacts-fit-criterion">
                  <span className={iconClass}>
                    {row.ok === 'pass' ? '✓' : row.ok === 'warn' ? '~' : '✗'}
                  </span>
                  <span className="contacts-fit-criterion-text">{row.text}</span>
                  <span className="contacts-fit-criterion-val">{row.val}</span>
                </div>
              );
            }

            return (
              <div key={`${row.text}-${i}`} className="space-y-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleBar(barKey)}
                  className="contacts-fit-criterion w-full cursor-pointer rounded-md border-0 bg-transparent p-0 text-left transition-colors hover:bg-[rgba(13,53,71,0.06)]"
                >
                  <span className={iconClass}>
                    {row.ok === 'pass' ? '✓' : row.ok === 'warn' ? '~' : '✗'}
                  </span>
                  <span className="contacts-fit-criterion-text">{row.text}</span>
                  <span className="flex items-center gap-0.5 justify-self-end">
                    <span className="contacts-fit-criterion-val">{row.val}</span>
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 text-[#7d909a] transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                      aria-hidden
                    />
                  </span>
                </button>
                {isOpen ? (
                  <div className="pl-[22px]">{renderFitCriterionPills(row.fitKey, component)}</div>
                ) : null}
              </div>
            );
          })}
            {heroCritState.icpId &&
              heroCritState.rows.some((r) => typeof r.fitKey === 'string' && !!r.fitKey) && (
                <p className="mt-1.5 text-[11px] leading-snug text-[#7d909a]">Click a row to unfold.</p>
              )}
          </>
        ) : (
          <p className="text-xs text-[#7d909a]">No ICP fit yet.</p>
        )}
      </div>
    </div>
  );

  const renderScoreInner = (score: CompanyFitIcpScoreRow, matchedId: string | null) => {
    const isBest = score.icp_id === matchedId;
    const breakdown = normalizeBreakdown(score);
    const components = breakdown?.components;

    return (
      <div
        key={score.icp_id}
        className={
          isBest
            ? ''
            : 'rounded-lg border border-slate-200 bg-white/80 px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
        }
      >
        <div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {isBest ? 'Best fit' : 'Also scored'}
            {score.icp_index != null ? `: ICP ${score.icp_index}` : ''}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">{score.icp_name || 'Unnamed ICP'}</p>
          {formatCompanyFitPercent(score.final_score) && (
            <div className="mt-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {formatCompanyFitPercent(score.final_score)}
              </span>
            </div>
          )}
        </div>

        {isBest && components && (
          <div className="mt-5 space-y-2.5">
            <p className="text-[11px] text-gray-400">Click a row to unfold detail</p>
            {COMPANY_FIT_COMPONENT_ORDER.map((key) => {
              const component = components[key];
              if (!component?.active) return null;
              const componentPercent = formatCompanyFitPercent(component.score01);
              const barKey = `icp:${score.icp_id}:${key}`;
              const isOpen = expandedBars.has(barKey);
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggleBar(barKey)}
                    className="w-full rounded-md px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-gray-100/80"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium leading-snug text-gray-700">{component.label}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {componentPercent && (
                          <span className="text-[11px] tabular-nums text-slate-500">{componentPercent}</span>
                        )}
                        <ChevronDown
                          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                        style={{
                          width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%`,
                        }}
                      />
                    </div>
                  </button>
                  {isOpen ? renderFitCriterionPills(key, component) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const detailSections = (
    <>
      {message && <p className="text-xs text-amber-700">{message}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!loading && details?.icp_scores?.length
        ? (() => {
            const matchedId = details.matched_icp_id;
            const bestScore =
              details.icp_scores.find((s) => s.icp_id === matchedId) ?? details.icp_scores[0];
            const otherScores = details.icp_scores.filter((s) => s.icp_id !== bestScore?.icp_id);

            if (otherScores.length === 0) return null;

            return (
              <div className="border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={() => setOtherIcpsOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-200 ${otherIcpsOpen ? '' : '-rotate-90'}`}
                  />
                  {otherIcpsOpen
                    ? 'Hide'
                    : `${otherScores.length} other ICP${otherScores.length > 1 ? 's' : ''}`}
                </button>
                {otherIcpsOpen && (
                  <div className="mt-3 space-y-3">
                    {otherScores.map((s) => renderScoreInner(s, matchedId))}
                  </div>
                )}
              </div>
            );
          })()
        : null}

      {!loading && !details?.icp_scores?.length && tableCompanyFitScore != null && tableMatchedIcpLabel ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
            {tableMatchedIcpLabel}
          </span>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3.5">
      {embedded && companyId && (
        <>
          {displayedFitSummary && (
            <div className="rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="text-sm leading-relaxed text-gray-800">{displayedFitSummary}</p>
            </div>
          )}
        </>
      )}
      {heroFitCard}
      {detailSections}
    </div>
  );
}
