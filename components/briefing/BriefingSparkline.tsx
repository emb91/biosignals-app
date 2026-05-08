'use client';

import { useEffect, useId, useState } from 'react';

const W = 240;
const H = 56;
const P = 2;

export function BriefingSparkline({ accent }: { accent: string }) {
  const gradId = useId().replace(/:/g, '');
  const [data, setData] = useState(() => Array.from({ length: 28 }, () => 12 + Math.random() * 22));

  useEffect(() => {
    const t = setInterval(() => {
      setData((prev) => {
        const next = prev.slice(1);
        const last = prev[prev.length - 1]!;
        next.push(Math.max(6, Math.min(36, last + (Math.random() * 8 - 4))));
        return next;
      });
    }, 1600);
    return () => clearInterval(t);
  }, []);

  const max = 38;
  const min = 4;
  const xs = data.map((_, i) => P + (i * (W - P * 2)) / (data.length - 1));
  const ys = data.map((v) => H - P - ((v - min) / (max - min)) * (H - P * 2));
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ');
  const area = `${path} L${xs[xs.length - 1]!.toFixed(1)},${H} L${xs[0]!.toFixed(1)},${H} Z`;
  const lastX = xs[xs.length - 1]!;
  const lastY = ys[ys.length - 1]!;

  return (
    <svg className="mt-1 block w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={path}
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
