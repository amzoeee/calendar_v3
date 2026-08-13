'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserTimeZone } from '@/lib/timezone';

// Server Components (e.g. the stats page) can't read the browser's timezone
// directly, so this mirrors it into a cookie they can read via `cookies()`.
// Refreshes once when the cookie is missing or stale so the very first
// server render after a timezone change picks it up.
export default function TimezoneSync() {
  const router = useRouter();

  useEffect(() => {
    const tz = getBrowserTimeZone();
    const match = document.cookie.match(/(?:^|; )tz=([^;]*)/);
    const current = match ? decodeURIComponent(match[1]) : null;
    if (current !== tz) {
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
      router.refresh();
    }
  }, [router]);

  return null;
}
