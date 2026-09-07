'use client';

import { useCallback, useEffect, useRef } from 'react';

interface Offset {
  left: number;
  top: number;
}

// Where each remembered scroller was last left, keyed by the id its caller
// passes. Module state rather than storage: paging is a client-side navigation,
// so this outlives the remount it has to survive, while a real page load starts
// the view at the top-left again.
const offsets = new Map<string, Offset>();

/**
 * Keeps a scrollable region where the user left it across the remount that
 * changing pages causes.
 *
 * Next.js keys a route segment by its dynamic param, so paging the stats range
 * builds a fresh subtree: a chart the user had scrolled halfway through comes
 * back at its left edge, and the page they had read down comes back at the top.
 * On a phone, where every chart is wider than the screen and the column is
 * several screens tall, that means re-finding their place after every step.
 *
 * Both axes are recorded, whether or not the element scrolls in both — a
 * horizontal-only scroller just stores a `top` of 0 forever.
 *
 * Restoring happens twice, and both times are needed. The ref callback runs
 * inside the commit, so a region that nothing else touches never paints at zero
 * on its way back. But the app router resets the nearest scrolling ancestor on
 * every navigation, which lands after that and takes the vertical offset back
 * to the top — so a mount effect, which runs after those layout effects, puts
 * it back. (The calendar views restore from a mount effect for the same
 * reason.)
 *
 * Returns a ref callback for the scrolling element.
 */
export function usePreservedScroll<T extends HTMLElement>(key: string) {
  const node = useRef<T | null>(null);

  // The browser clamps these for us when the content is smaller than it was
  // when the offset was recorded — a shorter range, or a rotated phone.
  const restore = (el: T) => {
    const saved = offsets.get(key);
    if (!saved) return;
    el.scrollLeft = saved.left;
    el.scrollTop = saved.top;
  };

  const record = (el: T) => offsets.set(key, { left: el.scrollLeft, top: el.scrollTop });

  const ref = useCallback(
    (el: T | null) => {
      node.current = el;
      if (!el) return;
      restore(el);

      const handleScroll = () => record(el);
      el.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        node.current = null;
        el.removeEventListener('scroll', handleScroll);
        // One last read on the way out. A scroll event can still be owed to us
        // when the navigation happens — the browser dispatches them while it
        // updates the rendering, which it puts off for a backgrounded tab and
        // can coalesce with the frame the navigation lands on. React runs this
        // cleanup before it detaches the node, so the offsets are still real;
        // the guard is in case that ever stops being true, since a detached
        // element reads 0 and would overwrite a good position with the top.
        if (el.isConnected) record(el);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (node.current) restore(node.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ref;
}
