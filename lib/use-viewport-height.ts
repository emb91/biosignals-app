'use client';

import { useEffect, useState } from 'react';

/**
 * The visible viewport height in PX (`window.innerHeight`), tracked across
 * resizes. Use this for full-height app shells instead of the CSS `100vh` /
 * `100dvh` units.
 *
 * Why: in some embedded / forwarded / zoomed browser contexts, `100vh` (and even
 * `100dvh`) resolve TALLER than the actually-visible viewport. A page sized in
 * those units then overflows the real screen and the whole document body scrolls
 * — content gets cut off below an "arbitrary" line. `window.innerHeight` is
 * always the true visible height, so sizing the shell to it eliminates the gap.
 *
 * Returns null before mount (SSR / first paint) — callers should fall back to
 * `'100dvh'` for that single frame, then the measured px takes over.
 */
export function useViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return height;
}
