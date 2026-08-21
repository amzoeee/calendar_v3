'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// How long to wait after the last navigation input before actually fetching.
// Comfortably longer than the ~30ms OS key-repeat interval, so holding an arrow
// key still coalesces into one fetch, while a single deliberate press starts
// loading before anyone notices.
const NAV_DEBOUNCE_MS = 150;

/**
 * Debounced date paging for the date-ranged views.
 *
 * Every page used to be its own `router.push` — session lookup, DB query and
 * server render — including for the days a user only passes through while
 * holding an arrow key. This coalesces a burst into a single fetch of the date
 * they actually land on, while `activeDate` follows every input immediately so
 * the header still moves with the keys.
 *
 * `date` is the date the server rendered (the route param); `basePath` is the
 * route it lives under, e.g. `/calendar`.
 */
export function useDateNavigation(date: string, basePath: string) {
  const router = useRouter();
  // Where the user has paged to, when that's ahead of what the server has
  // rendered. `queued` says whether its fetch is still sitting in the debounce.
  const [pending, setPending] = useState<{ date: string; queued: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjust-state-during-render: a render has landed, so drop the override it
  // satisfies. The exception is a render arriving while a *later* page is still
  // queued (the user kept paging after this one was requested) — holding the
  // override there stops the header from snapping backwards for a moment.
  const [prevDate, setPrevDate] = useState(date);
  if (prevDate !== date) {
    setPrevDate(date);
    if (pending && (!pending.queued || pending.date === date)) setPending(null);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // `href` overrides the destination for callers that need query params on it;
  // the debounce and the local date update work the same either way.
  const navigateTo = useCallback(
    (next: string, href?: string) => {
      setPending({ date: next, queued: true });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Paged away and back again inside the debounce window: what's on
        // screen is already right, so there's nothing to fetch.
        if (href === undefined && next === date) {
          setPending(null);
          return;
        }
        setPending((p) => (p ? { ...p, queued: false } : p));
        router.push(href ?? `${basePath}/${next}`);
      }, NAV_DEBOUNCE_MS);
    },
    [router, basePath, date],
  );

  return {
    // What the header should show: where the user has paged to, which is the
    // rendered date except while a fetch is still catching up.
    activeDate: pending?.date ?? date,
    navigateTo,
  };
}
