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
import { quarterLabel } from '@/lib/coverage/period';

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
      {/* Mirrors the page's SectionHeader markup (design language) so the block hides together. */}
      <div className="sec-head">
        <div className="sec-head-left">
          <div>
            <p className="sec-title">
              <span className="sec-step">4 ·</span>
              Target history
            </p>
            <p className="sec-source">What you aimed for each quarter and how much you closed against it.</p>
          </div>
        </div>
        {entries.length === 1 && <span className="sec-source">History builds as quarters close.</span>}
      </div>

      <div className="glass history-card">
        <div className="history-grid">
          {entries.map((entry) => {
            const isCurrent = entry.period === data.period;
            const isClosed = entry.period < data.period;
            const pct = entry.attainmentPct;
            const hit = pct != null && pct >= 1;
            const fillStyle = {
              width: `${Math.min(1, Math.max(0, pct ?? 0)) * 100}%`,
              ...(isClosed && !hit ? { background: 'linear-gradient(90deg,#d8a23e,#e7c478)' } : {}),
            };
            return (
              <div key={entry.period} className="history-cell">
                <div className="history-cell-head">
                  <span className="history-period">{quarterLabel(entry.period)}</span>
                  {isCurrent && <span className="history-tag">in progress</span>}
                </div>
                <div className="history-bar">
                  <div className="history-bar-fill" style={fillStyle} />
                </div>
                <p className="history-meta">
                  <strong>{formatAmount(entry.type, entry.attained)}</strong> of{' '}
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
