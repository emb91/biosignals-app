'use client';

import { useId } from 'react';

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

/** Pulse tile: workspace signal counts (daily) vs 7-day trailing average, same vertical scale */
export function BriefingSparkline({ accent, values }: { accent: string; values: number[] }) {
  const gradId = useId().replace(/:/g, '');

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

  return (
    <svg
      className="mt-1 block h-[3.5rem] w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Chart of signal events per day for the last four weeks, teal line is daily count and grey line is seven day average"
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
      <circle cx={lastX} cy={lastY} r="6" fill={accent} fillOpacity="0.18" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={accent} />
    </svg>
  );
}
