'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const POLL_MS = 10_000;

/**
 * Keeps the pending-import banner honest when a batch is staged from outside
 * this tab, which is the normal case for the Discord bot.
 *
 * The banner lives in the dashboard layout, and App Router reuses a shared
 * layout across client-side navigation — moving between Settings and a
 * calendar day re-renders only the page underneath it. So a batch staged
 * mid-session stayed invisible until a full page load, however fresh the
 * server's own cache was.
 *
 * `count` is the value the server just rendered. When the real count differs,
 * refreshing re-renders the route, layout included.
 */
export default function PendingSync({ count }: { count: number }) {
  const router = useRouter();
  // Moving between pages under this layout doesn't re-render it, so a
  // navigation is exactly when the banner is most likely to be out of date.
  const pathname = usePathname();
  // Held in a ref so the polling effect doesn't restart, and its timer isn't
  // torn down, every time the count changes.
  const renderedCount = useRef(count);
  useEffect(() => {
    renderedCount.current = count;
  }, [count]);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/pending-count');
        if (!res.ok) return;
        const { count: actual } = await res.json();
        if (!cancelled && actual !== renderedCount.current) router.refresh();
      } catch {
        // Offline or mid-deploy: the next tick tries again.
      }
    }

    check();

    const timer = setInterval(check, POLL_MS);
    // Catches the common case of approving on a phone and coming back here.
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [router, pathname]);

  return null;
}
