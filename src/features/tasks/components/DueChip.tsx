'use client';

import { useSyncExternalStore } from 'react';
import { CalendarClock } from 'lucide-react';
import { pacificDbStringToDate, formatDateInputValue } from '@/lib/timezone';
import { dueState, formatDue } from '@/lib/taskSchedule';

/**
 * A task's deadline, said the way a person would: the time alone when it's
 * today, a weekday inside the coming week, a date beyond that. Colour carries
 * urgency so a list can be scanned without reading every date, and a completed
 * task drops back to grey — a finished task being "overdue" is noise.
 */
export default function DueChip({
  due,
  hasTime,
  asap,
  done,
}: {
  due: string | null;
  hasTime: boolean;
  asap: boolean;
  done: boolean;
}) {
  // The label reads the host's clock and timezone, which differ between the
  // server and the browser, so it waits for hydration (#136).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  if (asap) {
    return (
      <span
        className={`flex items-center gap-1 text-[10px] leading-none shrink-0 ${
          done ? 'text-muted-foreground' : 'text-amber-400'
        }`}
      >
        <CalendarClock className="h-2.5 w-2.5" />
        ASAP
      </span>
    );
  }
  if (!due || !hydrated) return null;

  const now = new Date();
  const dueDate = pacificDbStringToDate(due);
  const state = done ? 'later' : dueState(formatDateInputValue(dueDate), formatDateInputValue(now));

  const tone = done
    ? 'text-muted-foreground'
    : state === 'overdue'
      ? 'text-red-400'
      : state === 'today'
        ? 'text-amber-400'
        : 'text-muted-foreground';

  return (
    <span className={`flex items-center gap-1 text-[10px] leading-none shrink-0 ${tone}`}>
      <CalendarClock className="h-2.5 w-2.5" />
      {formatDue(dueDate, hasTime, now)}
    </span>
  );
}

const noopSubscribe = () => () => {};
