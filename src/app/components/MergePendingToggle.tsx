'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MERGE_PENDING_COOKIE } from '@/lib/merge-pending';

/**
 * The merge choice is a cookie, so it sticks and the calendar pages can draw
 * the merged events; refreshing re-renders them with it.
 */
export default function MergePendingToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  function toggle(next: boolean) {
    setOn(next);
    document.cookie = `${MERGE_PENDING_COOKIE}=${next ? 1 : 0}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <label
      className="flex items-center gap-1.5 text-xs text-amber-200 cursor-pointer select-none"
      title="Join back-to-back events with the same name, including the one right before this import"
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => toggle(e.target.checked)}
        className="accent-amber-500 cursor-pointer"
      />
      Merge same-name
    </label>
  );
}
