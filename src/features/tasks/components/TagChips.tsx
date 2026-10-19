'use client';

import { type TaskTag } from '../types';

/**
 * A row's tags. Two chips at most before collapsing to a count — a task with
 * five tags shouldn't push its own title out of the row.
 *
 * Names are shown at every width. They used to be hidden below `sm`, on the
 * reasoning that a phone is narrow — which had it backwards: a phone shows one
 * list across the full window, so it has *more* room per column than three
 * lists side by side on a desktop. Long names truncate instead.
 */
export default function TagChips({ tags }: { tags: TaskTag[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {shown.map((t) => (
        <span key={t.id} className="flex items-center gap-1 min-w-0">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: t.color }}
            title={t.name}
          />
          <span className="text-[10px] leading-none text-muted-foreground truncate max-w-[8rem]">
            {t.name}
          </span>
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] leading-none text-muted-foreground shrink-0">+{extra}</span>
      )}
    </div>
  );
}
