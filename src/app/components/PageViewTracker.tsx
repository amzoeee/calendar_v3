'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/track';
import type { UsageName } from '@/lib/usage-catalog';

function viewOf(pathname: string): UsageName | null {
  if (pathname.startsWith('/calendar')) return 'view.daily';
  if (pathname.startsWith('/weekly')) return 'view.weekly';
  if (pathname.startsWith('/tasks')) return 'view.tasks';
  if (pathname.startsWith('/stats/lifetime')) return 'view.lifetime';
  if (pathname.startsWith('/stats')) return 'view.stats';
  if (pathname.startsWith('/settings')) return 'view.settings';
  return null;
}

// Records a view when the user switches to it, not on every date paged within it.
export default function PageViewTracker() {
  const pathname = usePathname();
  const lastView = useRef<UsageName | null>(null);

  useEffect(() => {
    const view = viewOf(pathname);
    if (view && view !== lastView.current) track(view);
    lastView.current = view;
  }, [pathname]);

  return null;
}
