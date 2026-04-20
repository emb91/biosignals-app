'use client';

/**
 * ArcovaLoader
 * A dot leads the stroke drawing the triangle, then immediately leads the
 * stroke drawing the circle around it, then both fade and the cycle repeats.
 *
 * All timings share a single 3 s linear cycle so the dot is always exactly
 * at the tip of the growing stroke.
 *
 * Cycle breakdown (3 s total, linear):
 *   0 %  → 40 %   triangle draws   (1.2 s)
 *   40 % → 84 %   circle draws     (1.32 s)  — starts immediately, no gap
 *   84 % → 92 %   hold complete
 *   92 % → 100 %  fade out & reset
 */
export function ArcovaLoader({ size = 36 }: { size?: number }) {
  const teal     = '#00A4B4';
  const CYCLE    = 3;         // seconds
  const TRI_END  = 0.40;      // fraction when triangle finishes / circle starts
  const CIRC_END = 0.84;      // fraction when circle finishes
  const FADE_END = 1.00;

  // Approximate path lengths in the 100×100 viewBox
  const triLen  = 171;   // perimeter of the triangle
  const circLen = 277;   // circumference of r=44 circle

  return (
    <>
      <style>{`
        /* ── Triangle stroke ── */
        @keyframes atri {
          0%               { stroke-dashoffset: ${triLen};  opacity: 1; }
          ${TRI_END * 100}%  { stroke-dashoffset: 0;          opacity: 1; }
          ${CIRC_END * 100}% { stroke-dashoffset: 0;          opacity: 1; }
          ${92}%             { stroke-dashoffset: 0;          opacity: 0; }
          100%             { stroke-dashoffset: ${triLen};  opacity: 0; }
        }
        /* ── Circle stroke — starts exactly at TRI_END, no pause ── */
        @keyframes acirc {
          0%                       { stroke-dashoffset: ${circLen}; opacity: 0; }
          ${TRI_END * 100 - 0.5}%  { stroke-dashoffset: ${circLen}; opacity: 0; }
          ${TRI_END * 100}%        { stroke-dashoffset: ${circLen}; opacity: 1; }
          ${CIRC_END * 100}%       { stroke-dashoffset: 0;          opacity: 1; }
          ${92}%                   { stroke-dashoffset: 0;          opacity: 0; }
          100%                     { stroke-dashoffset: ${circLen}; opacity: 0; }
        }
        /* ── Triangle dot visibility ── */
        @keyframes adottri {
          0%                       { opacity: 1; }
          ${TRI_END * 100 - 2}%    { opacity: 1; }
          ${TRI_END * 100}%        { opacity: 0; }
          100%                     { opacity: 0; }
        }
        /* ── Circle dot visibility ── */
        @keyframes adotcirc {
          0%                       { opacity: 0; }
          ${TRI_END * 100 - 0.5}%  { opacity: 0; }
          ${TRI_END * 100}%        { opacity: 1; }
          ${CIRC_END * 100 - 2}%   { opacity: 1; }
          ${CIRC_END * 100}%       { opacity: 0; }
          100%                     { opacity: 0; }
        }

        .al-tri  {
          stroke-dasharray: ${triLen};
          animation: atri ${CYCLE}s linear infinite;
        }
        .al-circ {
          stroke-dasharray: ${circLen};
          /* rotate so stroke starts drawing from 12 o'clock */
          transform: rotate(-90deg);
          transform-origin: 50px 50px;
          animation: acirc ${CYCLE}s linear infinite;
        }
        .al-dot-tri  { animation: adottri  ${CYCLE}s linear infinite; }
        .al-dot-circ { animation: adotcirc ${CYCLE}s linear infinite; }
      `}</style>

      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Loading">

        {/* Triangle stroke */}
        <path
          d="M50,18 L79,68 L21,68 Z"
          stroke={teal}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="al-tri"
        />

        {/* Circle stroke — same strokeWidth as triangle */}
        <circle
          cx="50" cy="50" r="44"
          stroke={teal}
          strokeWidth="7"
          strokeLinecap="round"
          className="al-circ"
        />

        {/*
          Triangle dot — travels the full triangle during [0, TRI_END] of the 3 s cycle.
          keyPoints/keyTimes lock it to the same linear rate as the stroke, so it is
          always exactly at the tip of the growing line.
        */}
        <circle r="4.5" fill={teal} className="al-dot-tri">
          <animateMotion
            dur={`${CYCLE}s`}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints={`0;1;1;1`}
            keyTimes={`0;${TRI_END};${CIRC_END};1`}
            path="M50,18 L79,68 L21,68 Z"
          />
        </circle>

        {/*
          Circle dot — travels the full circle during [TRI_END, CIRC_END] of the 3 s cycle.
          Stationary at start (keyPoint 0) until TRI_END, then sweeps to 1 by CIRC_END.
          Starts from 12 o'clock to match the rotated stroke.
        */}
        <circle r="4.5" fill={teal} className="al-dot-circ">
          <animateMotion
            dur={`${CYCLE}s`}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints={`0;0;1;1`}
            keyTimes={`0;${TRI_END};${CIRC_END};1`}
            path="M50,6 A44,44 0 0,1 50,94 A44,44 0 0,1 50,6"
          />
        </circle>

      </svg>
    </>
  );
}
