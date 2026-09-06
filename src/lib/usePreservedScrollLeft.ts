'use client';

import { useCallback } from 'react';

// Where each remembered scroller was last left, keyed by the id its caller
// passes. Module state rather than storage: paging is a client-side navigation,
// so this outlives the remount it has to survive, while a real page load starts
// the view at its left edge again.
const offsets = new Map<string, number>();

/**
 * Keeps a horizontally scrollable region where the user left it across the
 * remount that changing pages causes.
 *
 * Next.js keys a route segment by its dynamic param, so paging the stats range
 * builds a fresh subtree: a chart the user had scrolled halfway through comes
 * back at its left edge, and on a phone — where every chart is wider than the
 * screen — that means re-scrolling to the same spot after every step.
 *
 * The offset is recorded as it changes and put back as the node attaches, which
 * happens inside the commit, so the chart never paints at zero on its way to
 * the remembered position.
 *
 * Returns a ref callback for the scrolling element.
 */
export function usePreservedScrollLeft<T extends HTMLElement>(key: string) {
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      // The browser clamps this for us when the content is narrower than it was
      // when the offset was recorded — a shorter range, or a rotated phone.
      const saved = offsets.get(key);
      if (saved) el.scrollLeft = saved;

      const handleScroll = () => offsets.set(key, el.scrollLeft);
      el.addEventListener('scroll', handleScroll, { passive: true });
      return () => el.removeEventListener('scroll', handleScroll);
    },
    [key],
  );
}
