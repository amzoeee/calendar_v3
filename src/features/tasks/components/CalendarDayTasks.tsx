'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { useUndo } from '@/app/components/UndoToast';
import EditTaskDialog from '@/features/tasks/components/EditTaskDialog';
import { setTaskCompletionAction, toggleTaskCompletionAction } from '@/features/tasks/server/actions';
import type { CalendarTask } from '@/lib/calendarTasks';

// A day with more tasks than this shows the first and "… and N others".
const MAX_LINES = 2;

/**
 * A day's tasks as chips: a checkbox to tick one off and a title that opens
 * it on its board. The overflow line opens the full list.
 */
export default function CalendarDayTasks({ date, tasks }: { date: string; tasks: CalendarTask[] }) {
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

  // Where the full list opened from; null while it's closed.
  const [listAt, setListAt] = useState<{ x: number; y: number } | null>(null);
  const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

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

  const isDone = (task: CalendarTask) => overrides[task.id] ?? task.done;
  const chip = (task: CalendarTask) => (
    <TaskChip key={task.id} task={task} done={isDone(task)} onToggle={() => toggle(task, !isDone(task))} />
  );
  const collapsed = tasks.length > MAX_LINES;

  return (
    <div className="space-y-0.5">
      {(collapsed ? tasks.slice(0, MAX_LINES - 1) : tasks).map(chip)}
      {collapsed && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setListAt({ x: r.left, y: r.bottom + 4 });
          }}
          className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-secondary/70 hover:text-foreground transition-colors cursor-pointer"
        >
          … and {tasks.length - (MAX_LINES - 1)} others
        </button>
      )}

      {listAt && (
        <EditTaskDialog at={listAt} label={`Tasks, ${dayLabel}`} onClose={() => setListAt(null)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base md:text-xs font-bold text-foreground">{dayLabel}</h2>
            <button
              type="button"
              onClick={() => setListAt(null)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-0.5">{tasks.map(chip)}</div>
        </EditTaskDialog>
      )}
    </div>
  );
}

function TaskChip({ task, done, onToggle }: { task: CalendarTask; done: boolean; onToggle: () => void }) {
  return (
    <div
      data-calendar-task={task.id}
      className="flex w-full items-center gap-1 min-w-0 rounded bg-secondary/70 border-l-2 pl-1 pr-1.5 py-0.5 text-xs"
      style={{ borderLeftColor: task.color ?? 'var(--color-muted-foreground)' }}
    >
      <button
        type="button"
        onClick={onToggle}
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
}
