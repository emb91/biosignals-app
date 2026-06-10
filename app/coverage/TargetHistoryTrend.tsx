'use client';

/**
 * "4 · Target history" section at the bottom of the Coverage page.
 *
 * Shows how quarterly targets changed over time and how attainment improved,
 * one compact cell per period (oldest left, current quarter last): quarter
 * label, attained vs target, and a small bar capped visually at 100% with the
 * real percentage as text. Closed quarters at or above 100% go emerald (the
 * sales point: Arcova improving target attainment); closed misses go amber;
 * the in-progress quarter stays teal with an "in progress" tag so a partial
 * quarter doesn't read as a miss.
 *
 * Self-contained on purpose: fetches GET /api/coverage/target itself (a
 * second cached fetch alongside the page's own) and renders its own section
 * header + card, returning null while loading or when there is no target
 * history so the whole block disappears together and the page only needs a
 * single unconditional JSX insertion.
 */

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { quarterLabel } from '@/lib/coverage/period';
import { cn } from '@/lib/utils';

type TargetHistoryEntry = {
  period: string;
  type: 'revenue' | 'deals';
  value: number;
  attained: number;
  attainmentPct: number | null;
};

type TargetHistoryResponse = {
  period: string;
  history: TargetHistoryEntry[];
};

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function formatAmount(type: TargetHistoryEntry['type'], value: number): string {
  return type === 'revenue' ? formatCompactUsd(value) : Math.round(value).toLocaleString();
}

export default function TargetHistoryTrend() {
  const [data, setData] = useState<TargetHistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/coverage/target');
        if (!res.ok) return;
        const payload = (await res.json()) as TargetHistoryResponse;
        if (!cancelled && Array.isArray(payload.history)) setData(payload);
      } catch {
        // Render nothing on failure; the rest of the page still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.history.length === 0) return null;

  const entries = [...data.history].sort((a, b) => a.period.localeCompare(b.period));

  return (
    <>
      {/* Mirrors the page's SectionHeader markup so the whole block can hide together. */}
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
            <History className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              <span className="mr-1.5 text-gray-400">4 ·</span>
              Target history
            </p>
            <p className="text-xs text-gray-400">How your targets and attainment evolve quarter over quarter.</p>
          </div>
        </div>
        {entries.length === 1 && (
          <p className="text-xs text-gray-400">History builds as quarters close.</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {entries.map((entry) => {
            const isCurrent = entry.period === data.period;
            const isClosed = entry.period < data.period;
            const pct = entry.attainmentPct;
            const hit = pct != null && pct >= 1;
            const barClass = isClosed
              ? hit
                ? 'bg-emerald-500'
                : 'bg-amber-400'
              : 'bg-arcova-teal';
            const attainedClass = isClosed && hit ? 'font-semibold text-emerald-600' : 'font-semibold text-gray-700';
            return (
              <div key={entry.period} className="min-w-[150px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-700">{quarterLabel(entry.period)}</span>
                  {isCurrent && (
                    <span className="inline-flex items-center rounded-full border border-arcova-teal/30 bg-arcova-teal/5 px-1.5 py-px text-[10px] font-medium text-arcova-teal">
                      in progress
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={cn('h-full rounded-full', barClass)}
                    style={{ width: `${Math.min(1, Math.max(0, pct ?? 0)) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-gray-500">
                  <span className={attainedClass}>{formatAmount(entry.type, entry.attained)}</span> of{' '}
                  {formatAmount(entry.type, entry.value)}
                  {entry.type === 'deals' && ' deals'}
                  {pct != null && <> ({Math.round(pct * 100)}%)</>}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
