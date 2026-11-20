'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { useUndo } from '@/app/components/UndoToast';
import { setTaskCompletionAction, toggleTaskCompletionAction } from '@/features/tasks/server/actions';
import type { CalendarTask } from '@/lib/calendarTasks';

/**
 * A day's tasks as chips: a checkbox to tick one off and a title that opens
 * it on its board. `row` wraps them in a line (the daily view); `stack` lists
 * them top to bottom (a week column).
 */
export default function CalendarDayTasks({ tasks, layout }: { tasks: CalendarTask[]; layout: 'row' | 'stack' }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { raiseUndo } = useUndo();
  const [, startTransition] = useTransition();

  // Optimistic ticks, dropped when the server's tasks arrive.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [synced, setSynced] = useState(tasks);
  if (tasks !== synced) {
    setSynced(tasks);
    setOverrides({});
  }

  const toggle = async (task: CalendarTask, completed: boolean) => {
    if (completed && task.openSubtasks > 0) {
      const n = task.openSubtasks;
      const ok = await confirm({
        title: `${n} subtask${n === 1 ? '' : 's'} still open`,
        message: `Completing “${task.title}” will complete ${n === 1 ? 'it' : 'them'} too. Close it anyway?`,
        confirmLabel: 'Complete all',
        cancelLabel: 'Keep it open',
      });
      if (!ok) return;
    }
    setOverrides((o) => ({ ...o, [task.id]: completed }));
    startTransition(async () => {
      const { changed, rolled } = await toggleTaskCompletionAction(task.id, completed, true);
      if (changed.length > 0) {
        raiseUndo({
          message: !completed
            ? `Moved “${task.title}” back to your list`
            : rolled
              ? `Completed “${task.title}” — moved to the next one`
              : `Completed “${task.title}”`,
          undo: () =>
            startTransition(async () => {
              await setTaskCompletionAction(changed, !completed, rolled);
              router.refresh();
            }),
        });
      }
      router.refresh();
    });
  };

  return (
    <div className={layout === 'row' ? 'flex flex-wrap gap-1.5' : 'space-y-0.5'}>
      {tasks.map((task) => {
        const done = overrides[task.id] ?? task.done;
        return (
          <div
            key={task.id}
            data-calendar-task={task.id}
            className={`flex items-center gap-1 min-w-0 rounded bg-secondary/70 border-l-2 pl-1 pr-1.5 py-0.5 text-xs ${
              layout === 'row' ? 'max-w-full' : 'w-full'
            }`}
            style={{ borderLeftColor: task.color ?? 'var(--color-muted-foreground)' }}
          >
            <button
              type="button"
              onClick={() => toggle(task, !done)}
              aria-label={done ? `Mark “${task.title}” not done` : `Complete “${task.title}”`}
              className={`shrink-0 h-4 w-4 md:h-3.5 md:w-3.5 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
                done ? 'bg-muted-foreground border-muted-foreground text-background' : 'border-muted-foreground hover:border-foreground'
              }`}
            >
              {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </button>
            <Link
              href={`/tasks/${task.boardId}?task=${task.id}`}
              title={task.title}
              className={`truncate min-w-0 hover:underline ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}
            >
              {task.title}
            </Link>
            {task.asap && !done && <span className="shrink-0 text-[9px] font-bold text-amber-400">ASAP</span>}
            {task.time && <span className="shrink-0 text-[10px] text-muted-foreground">{task.time}</span>}
          </div>
        );
      })}
    </div>
  );
}
