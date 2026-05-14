/**
 * `useScrollMask` — track whether a scroll container has room to scroll downward,
 * so callers can apply a bottom fade-out mask only when there's hidden content
 * below the viewport.
 *
 * Used by the accounts / contacts / customers tables: the fade looks great while
 * the user is mid-scroll, but at the bottom of the list it was clipping the last
 * couple of rows and there was no way to see them in full. This hook returns
 * `hasMore: true` when the container has more rows below the visible area; pair
 * it with a conditional `maskImage` style on the scroll element.
 *
 * Re-measures on:
 *   - scroll
 *   - window resize
 *   - the scroll container's own box changing (ResizeObserver)
 *   - any value in `deps` changing (e.g. the row count) — this is how the hook
 *     learns about newly streamed-in rows that don't change the container's box
 *     but do change its scrollHeight.
 *
 * (We deliberately avoid MutationObserver with subtree:true — it fires on every
 * hover / class toggle inside the rows and turns scroll into a slideshow.)
 */
'use client';

import { useEffect, useState, type DependencyList, type RefObject } from 'react';

const SCROLL_BOTTOM_THRESHOLD_PX = 4;

export function useScrollMask(
  scrollRef: RefObject<HTMLElement | null>,
  deps: DependencyList = [],
): { hasMore: boolean } {
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      setHasMore(distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
    // The consumer-supplied deps array drives re-measure when row data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, ...deps]);

  return { hasMore };
}
