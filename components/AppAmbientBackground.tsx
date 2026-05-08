'use client';

/** Fixed aurora layer for the authenticated app shell (Arcova Today aesthetic). */

const PALETTE = ['#a3e3df', '#c8e7f0', '#fde7c8', '#d2f0e9'] as const;

export function AppAmbientBackground({ intensity = 1 }: { intensity?: number }) {
  const blobs = [
    { c: PALETTE[0], top: '-12%', left: '-6%', w: 620, h: 620, dur: 38, delay: 0, o: 0.55 },
    { c: PALETTE[1], top: '8%', left: '52%', w: 720, h: 720, dur: 46, delay: -8, o: 0.42 },
    { c: PALETTE[2], top: '58%', left: '12%', w: 540, h: 540, dur: 52, delay: -14, o: 0.38 },
    { c: PALETTE[3], top: '62%', left: '64%', w: 480, h: 480, dur: 44, delay: -22, o: 0.34 },
  ];

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 min-h-[100dvh] w-full overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-b from-[#f6fbfb] via-[#eef6f6] to-[#f3f1ea]" />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.6), transparent 60%)',
        }}
      />
      {blobs.map((b, i) => (
        <div
          key={i}
          className="arcova-aurora-blob absolute rounded-full blur-[64px]"
          style={{
            top: b.top,
            left: b.left,
            width: b.w,
            height: b.h,
            background: `radial-gradient(circle at 30% 30%, ${b.c}, transparent 62%)`,
            animationDuration: `${b.dur}s`,
            animationDelay: `${b.delay}s`,
            opacity: b.o * intensity,
          }}
        />
      ))}
      <div
        className="absolute inset-0 opacity-[0.32] mix-blend-multiply motion-reduce:opacity-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(13,53,71,0.045) 0.6px, transparent 0.6px)',
          backgroundSize: '3px 3px',
        }}
      />
    </div>
  );
}
