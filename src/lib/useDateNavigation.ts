'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// How long to wait after the last navigation input before actually fetching.
// Comfortably longer than the ~30ms OS key-repeat interval, so holding an arrow
// key still coalesces into one fetch, while a single deliberate press starts
// loading before anyone notices.
const NAV_DEBOUNCE_MS = 150;

/**
 * Debounced paging for the date-ranged views.
 *
 * Every page used to be its own `router.push` — session lookup, DB query and
 * server render — including for the pages a user only passes through while
 * holding an arrow key. This coalesces a burst into a single fetch of the page
 * they actually land on, while `active` follows every input immediately so the
 * header still moves with the keys.
 *
 * `current` is what the server rendered: a date string for the daily and weekly
 * views, a `{ start, end }` range for stats. `hrefFor` turns a target into the
 * URL to push, and `keyOf` reduces one to the string that decides whether two
 * targets mean the same page — the identity of a plain date string by default.
 */
export function useDateNavigation<T>(
  current: T,
  hrefFor: (target: T) => string,
  keyOf: (target: T) => string = (t) => String(t),
) {
  const router = useRouter();
  // Where the user has paged to, while that's ahead of what the server has
  // rendered. `queued` says whether its fetch is still sitting in the debounce.
  const [pending, setPending] = useState<{ target: T; queued: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentKey = keyOf(current);

  // Callers pass fresh closures on every render; holding them in a ref keeps
  // `navigateTo` referentially stable, so the key and swipe listeners built on
  // it aren't torn down and rebound every time anything else re-renders.
  const fns = useRef({ hrefFor, keyOf });
  useEffect(() => {
    fns.current = { hrefFor, keyOf };
  });

  // Adjust-state-during-render: a render has landed, so drop the override it
  // satisfies. The exception is a render arriving while a *later* page is still
  // queued (the user kept paging after this one was requested) — holding the
  // override there stops the header from snapping backwards for a moment.
  const [prevKey, setPrevKey] = useState(currentKey);
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    if (pending && (!pending.queued || keyOf(pending.target) === currentKey)) setPending(null);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // `href` overrides the destination for callers that need something other than
  // `hrefFor` — a deep-link query param, or a filter change that keeps the page
  // it's already on. The debounce works the same either way.
  const navigateTo = useCallback(
    (target: T, href?: string) => {
      const targetKey = fns.current.keyOf(target);
      // There's nothing to show locally when the target is the page already on
      // screen, so don't take over the header for it.
      setPending(targetKey === currentKey ? null : { target, queued: true });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Paged away and back inside the debounce window: what's on screen is
        // already right, so there's nothing to fetch.
        if (href === undefined && targetKey === currentKey) return;
        setPending((p) => (p ? { ...p, queued: false } : p));
        router.push(href ?? fns.current.hrefFor(target));
      }, NAV_DEBOUNCE_MS);
    },
    [router, currentKey],
  );

  return {
    // What the header should show: where the user has paged to, which is what
    // the server rendered except while a fetch is still catching up.
    active: pending?.target ?? current,
    navigateTo,
  };
}
