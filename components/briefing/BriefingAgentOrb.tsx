'use client';

import { cn } from '@/lib/utils';

const ACCENT = '#00A4B4';
const ORB_SZ = 120;
const ORB_HALF = ORB_SZ / 2;

/** Centered "standing" orb for Today briefing chat (idle / empty input). Styles: `briefing-today` scope in briefing-today.css */
export function BriefingAgentOrb({ className }: { className?: string }) {
  return (
    <div className={cn('flex w-full max-w-full flex-col items-center px-2 pt-10 sm:pt-12', className)}>
      {/* Single stage: rings and sphere share the same center (rings use margin offset so pulse keyframes only scale). */}
      <div
        className="relative shrink-0"
        style={{ width: ORB_SZ + 48, height: ORB_SZ + 48 }}
      >
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 rounded-full motion-safe:opacity-90 motion-reduce:opacity-70"
          style={{
            width: ORB_SZ * 2.2,
            height: ORB_SZ * 2.2,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${ACCENT}44 0%, transparent 62%)`,
            filter: 'blur(20px)',
          }}
          aria-hidden
        />
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bt-orb-ring pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-[rgba(13,53,71,0.11)]"
            style={{
              width: ORB_SZ,
              height: ORB_SZ,
              marginLeft: -ORB_HALF,
              marginTop: -ORB_HALF,
              animationDelay: `${i * 1.55}s`,
            }}
            aria-hidden
          />
        ))}
        <div
          className="absolute left-1/2 top-1/2 z-[1]"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <div
            className="bt-orb-core relative overflow-hidden rounded-full shadow-[0_16px_36px_-12px_rgba(0,164,180,0.36),inset_0_-8px_20px_rgba(13,53,71,0.16),inset_0_4px_14px_rgba(255,255,255,0.45)]"
            style={{ width: ORB_SZ, height: ORB_SZ }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(circle at 30% 28%, #ffffff 0%, ${ACCENT} 56%, #003344 130%)`,
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 mix-blend-screen"
              style={{
                background:
                  'radial-gradient(ellipse 60% 30% at 36% 26%, rgba(255,255,255,0.72), transparent 60%)',
              }}
            />
            {[
              [12, 78, 1.6],
              [88, 22, 2],
              [44, 55, 1.2],
              [70, 70, 1.5],
              [24, 36, 1.1],
              [56, 18, 1.8],
            ].map(([x, y, r], i) => (
              <span
                key={i}
                className="pointer-events-none absolute rounded-full bg-white/75"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: r,
                  height: r,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: `0 0 6px ${ACCENT}`,
                  opacity: 0.55,
                }}
                aria-hidden
              />
            ))}
          </div>
        </div>
      </div>
      <div
        className="mt-2 flex h-6 items-end justify-center gap-1 opacity-[0.38] motion-reduce:opacity-25"
        aria-hidden
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="bt-orb-vbar w-[3px] origin-bottom rounded-sm bg-arcova-teal/75"
            style={{
              height: 6,
              animationDelay: `${i * 90}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
