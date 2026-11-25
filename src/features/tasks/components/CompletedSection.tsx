'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type TaskRenderRow } from '@/lib/tasks';

/**
 * A column's collapsible Completed pile. Always mounted, even when empty, so
 * whether it's open survives the pile emptying and refilling.
 */
export default function CompletedSection({
  count,
  rows,
  revealId,
  renderRow,
}: {
  count: number;
  rows: TaskRenderRow[];
  /** Opens the pile when this task is in it. */
  revealId: number | null;
  renderRow: (row: TaskRenderRow) => ReactNode;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  if (revealId !== revealed) {
    setRevealed(revealId);
    const holds = (r: TaskRenderRow): boolean => r.node.id === revealId || r.children.some(holds);
    if (rows.some(holds)) setShowCompleted(true);
  }

  if (count === 0) return null;

  return (
    <div className="mt-5">
      <button
        onClick={() => setShowCompleted((s) => !s)}
        aria-expanded={showCompleted}
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {showCompleted ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Completed ({count})
      </button>
      {showCompleted && (
        <div className="space-y-0.5 mt-1">
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}
