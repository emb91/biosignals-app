'use client';

import { useId, useRef, useState } from 'react';

const W = 240;
const H = 56;
const PAD = 2;

function trailingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const slice = values.slice(start, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / slice.length;
  });
}

function fmtDate(iso: string): string {
  // Parse as UTC midnight, format in user locale
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export type PulseDayBreakdown = {
  date: string; // "YYYY-MM-DD"
  count: number;
  top: Array<{ glyph: string; label: string; company: string }>;
};

/** Pulse tile: workspace signal counts (daily) vs 7-day trailing average, same vertical scale */
export function BriefingSparkline({
  accent,
  values,
  breakdown,
}: {
  accent: string;
  values: number[];
  breakdown?: PulseDayBreakdown[];
}) {
  const gradId = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const data = values.length >= 2 ? values : [...values, ...values];
  const avg = trailingAverage(values.length >= 2 ? values : data, 7);
  const maxSeries = Math.max(...data, ...avg, 1);
  const minSeries = 0;

  const xs = data.map((_, i) => PAD + (i * (W - PAD * 2)) / Math.max(data.length - 1, 1));
  const toY = (v: number) => H - PAD - ((v - minSeries) / (maxSeries - minSeries)) * (H - PAD * 2);
  const ys = data.map((v) => toY(Math.max(0, v)));
  const ysAvg = avg.map((v) => toY(v));

  const line = (yCoords: number[]) =>
    xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yCoords[i]!.toFixed(1)}`).join(' ');

  const pathMain = line(ys);
  const pathAvg = line(ysAvg);
  const area = `${pathMain} L${xs[xs.length - 1]!.toFixed(1)},${H} L${xs[0]!.toFixed(1)},${H} Z`;
  const lastX = xs[xs.length - 1]!;
  const lastY = ys[ys.length - 1]!;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(relX * (data.length - 1));
    setHoveredIdx(Math.max(0, Math.min(data.length - 1, idx)));
  };

  const handleMouseLeave = () => setHoveredIdx(null);

  const hovDay = hoveredIdx !== null ? breakdown?.[hoveredIdx] : undefined;
  // Position tooltip as % of container width, clamped away from edges
  const hovXPct = hoveredIdx !== null ? (hoveredIdx / Math.max(data.length - 1, 1)) * 100 : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        className="mt-1 block h-[3.5rem] w-full cursor-crosshair"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Chart of signal events per day for the last four weeks, teal line is daily count and grey line is seven day average"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path
          d={pathAvg}
          fill="none"
          stroke="rgb(13 53 71)"
          strokeOpacity={0.28}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={pathMain}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Terminal dot — hide when hovering a different point */}
        {(hoveredIdx === null || hoveredIdx === data.length - 1) && (
          <>
            <circle cx={lastX} cy={lastY} r="6" fill={accent} fillOpacity="0.18" />
            <circle cx={lastX} cy={lastY} r="2.5" fill={accent} />
          </>
        )}
        {/* Hover cursor + dot */}
        {hoveredIdx !== null && (
          <>
            <line
              x1={xs[hoveredIdx]!.toFixed(1)}
              y1={PAD}
              x2={xs[hoveredIdx]!.toFixed(1)}
              y2={H - PAD}
              stroke={accent}
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={xs[hoveredIdx]!.toFixed(1)}
              cy={ys[hoveredIdx]!.toFixed(1)}
              r="3"
              fill={accent}
            />
          </>
        )}
      </svg>

      {/* Hover tooltip */}
      {hovDay !== undefined && hovXPct !== null && (
        <div
          className="bt-sparkline-tip"
          style={{
            // Translate -50% to centre on the cursor, then clamp with CSS min/max
            left: `clamp(0px, calc(${hovXPct.toFixed(1)}% - 80px), calc(100% - 160px))`,
          }}
          role="tooltip"
        >
          <div className="bt-sparkline-tip-head">
            <span className="bt-sparkline-tip-date">{fmtDate(hovDay.date)}</span>
            <span className="bt-sparkline-tip-count" style={{ color: accent }}>
              {hovDay.count} signal{hovDay.count !== 1 ? 's' : ''}
            </span>
          </div>
          {hovDay.top.length > 0 ? (
            <ul className="bt-sparkline-tip-list">
              {hovDay.top.map((item, i) => (
                <li key={i} className="bt-sparkline-tip-row">
                  <span className="bt-sparkline-tip-glyph" style={{ color: accent }}>
                    {item.glyph}
                  </span>
                  <span className="bt-sparkline-tip-text">
                    {item.company ? <strong>{item.company}</strong> : null}
                    {item.company && item.label ? ' · ' : null}
                    <span>{item.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bt-sparkline-tip-empty">No signals this day</p>
          )}
        </div>
      )}
    </div>
  );
}
