import { dayStrOfInstant, dbStringToUtcMillis } from '@/lib/timezone';
import { displayTitle } from '@/lib/taskSchedule';

export interface CalendarTaskRow {
  id: number;
  boardId: number;
  title: string;
  counterValue: number | null;
  dueDatetime: string | null;
  dueHasTime: number;
  dueAsap: number;
  completedAt: string | null;
  openSubtasks: number;
  color: string | null;
}

/** A task as a calendar day's banner shows it. */
export interface CalendarTask {
  id: number;
  boardId: number;
  title: string;
  done: boolean;
  asap: boolean;
  /** The deadline's time in the viewer's timezone, for timed deadlines only. */
  time: string | null;
  openSubtasks: number;
  color: string | null;
}

export type CalendarTasksByDay = Record<string, CalendarTask[]>;

/**
 * Buckets tasks onto the viewer's days in [from, to]: each on the day its
 * deadline falls in `timeZone`, and open ASAP tasks on `today`.
 */
export function bucketCalendarTasks(
  rows: CalendarTaskRow[],
  { from, to, today, timeZone }: { from: string; to: string; today: string; timeZone: string }
): CalendarTasksByDay {
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const sorted: { day: string; key: number; task: CalendarTask }[] = [];

  for (const r of rows) {
    const done = r.completedAt !== null;
    let day: string;
    let ms = 0;
    if (r.dueAsap) {
      if (done) continue;
      day = today;
    } else if (r.dueDatetime) {
      ms = dbStringToUtcMillis(r.dueDatetime);
      day = dayStrOfInstant(ms, timeZone);
    } else {
      continue;
    }
    if (day < from || day > to) continue;

    const timed = !r.dueAsap && r.dueHasTime === 1;
    sorted.push({
      day,
      // Open before done, ASAP first, then timed by time, then day-only.
      key: (done ? 4e13 : 0) + (r.dueAsap ? 0 : timed ? 1e13 + ms / 1e3 : 3e13),
      task: {
        id: r.id,
        boardId: r.boardId,
        title: displayTitle(r.title, r.counterValue),
        done,
        asap: r.dueAsap === 1,
        time: timed ? timeFmt.format(ms) : null,
        openSubtasks: r.openSubtasks,
        color: r.color,
      },
    });
  }

  const byDay: CalendarTasksByDay = {};
  sorted
    .sort((a, b) => a.key - b.key || a.task.id - b.task.id)
    .forEach(({ day, task }) => (byDay[day] ??= []).push(task));
  return byDay;
}
