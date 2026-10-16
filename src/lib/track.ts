import type { UsageName, UsageProps } from '@/lib/usage-catalog';

// Client-side counterpart of `track` in usage.ts, for interactions that never
// reach the server (keys, swipes, zoom). Fire-and-forget.
export function track(name: UsageName, props?: UsageProps): void {
  if (typeof window === 'undefined') return;
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  const body = JSON.stringify({ name, props: { ...props, mobile } });
  try {
    if (navigator.sendBeacon?.('/api/usage', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/usage', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never break the page.
  }
}
