// Deadline and reminder maths for tasks.
//
// Everything here works on the app's Pacific wall-clock strings, the same
// convention events use. Pure functions only — no DB, no cookies — so the
// server action and the edit dialog's live preview can share them.

import { shiftDateStr, dbStringToUtcMillis, dateToServerDbString } from './timezone';

/** A date-only deadline is stored at the end of its day so it still sorts. */
export const END_OF_DAY = '23:59';

export interface RemindPreset {
  label: string;
  /** Minutes before a timed deadline. */
  minutes?: number;
  /** Whole days before a date-only deadline, paired with a time of day. */
  days?: number;
}

// Offsets for a deadline that names a time. Elapsed time from the deadline.
export const TIMED_PRESETS: RemindPreset[] = [
  { label: 'At the deadline', minutes: 0 },
  { label: '10 minutes before', minutes: 10 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '3 hours before', minutes: 180 },
  { label: '1 day before', minutes: 1440 },
  { label: '2 days before', minutes: 2880 },
  { label: '1 week before', minutes: 10080 },
];

// Offsets for a date-only deadline. Whole days, at a time you choose —
// "the day before at 6pm" rather than "1440 minutes before midnight".
export const DATED_PRESETS: RemindPreset[] = [
  { label: 'On the day', days: 0 },
  { label: '1 day before', days: 1 },
  { label: '2 days before', days: 2 },
  { label: '1 week before', days: 7 },
];

export const DEFAULT_REMIND_TIME = '09:00';

/**
 * When a reminder should fire, as a wall-clock string in the same timezone as
 * `dueDatetime`.
 *
 * The two offset shapes are computed differently on purpose:
 *
 * - **Days** are calendar arithmetic. "One day before at 6pm" means the
 *   previous date at six, so the date is stepped and the clock time is stapled
 *   on untouched. Computing it as 1440 minutes of elapsed time lands an hour
 *   out either side of a DST change — for a deadline late on a 25-hour day it
 *   lands on the wrong date entirely.
 * - **Minutes** are elapsed time, which is what "30 minutes before" means, so
 *   that one converts to an instant, subtracts, and converts back.
 */
export function computeRemindAt(
  dueDatetime: string | null,
  offsetMinutes: number | null,
  offsetDays: number | null,
  timeOfDay: string | null
): string | null {
  if (!dueDatetime) return null;

  if (offsetDays != null && timeOfDay) {
    const [datePart] = dueDatetime.split(' ');
    return `${shiftDateStr(datePart, -offsetDays)} ${timeOfDay}:00`;
  }

  if (offsetMinutes != null) {
    const ms = dbStringToUtcMillis(dueDatetime) - offsetMinutes * 60_000;
    return dateToServerDbString(new Date(ms));
  }

  return null;
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

/**
 * How urgent a deadline is, judged in the viewer's own day boundaries.
 * `todayStr` and `dueDateStr` are both "YYYY-MM-DD" as the viewer sees them.
 */
export function dueState(dueDateStr: string, todayStr: string): DueState {
  if (dueDateStr < todayStr) return 'overdue';
  if (dueDateStr === todayStr) return 'today';
  if (dueDateStr <= shiftDateStr(todayStr, 2)) return 'soon';
  return 'later';
}

/**
 * A deadline as a person would say it: the time alone when it's today, a
 * weekday when it's inside the coming week, otherwise a date. `due` is a real
 * instant, so its getters already read in the viewer's timezone.
 */
export function formatDue(due: Date, hasTime: boolean, now: Date): string {
  const sameDay = due.toDateString() === now.toDateString();
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (sameDay) return hasTime ? time : 'Today';

  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000
  );

  const label =
    days === 1
      ? 'Tomorrow'
      : days === -1
        ? 'Yesterday'
        : days > 1 && days < 7
          ? due.toLocaleDateString([], { weekday: 'short' })
          : due.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return hasTime ? `${label}, ${time}` : label;
}

/** Frequencies a task can repeat on, and the RRULE each one produces. */
export const REPEAT_OPTIONS: { label: string; rrule: string | null }[] = [
  { label: 'Does not repeat', rrule: null },
  { label: 'Every day', rrule: 'FREQ=DAILY;INTERVAL=1' },
  { label: 'Every week', rrule: 'FREQ=WEEKLY;INTERVAL=1' },
  { label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rrule: 'FREQ=MONTHLY;INTERVAL=1' },
  { label: 'Every year', rrule: 'FREQ=YEARLY;INTERVAL=1' },
];

export function repeatLabel(rrule: string | null): string | null {
  if (!rrule) return null;
  return REPEAT_OPTIONS.find((o) => o.rrule === rrule)?.label ?? 'Repeats';
}

/**
 * Substitute a rolling task's counter into its title.
 *
 * The stored title keeps the `{n}` placeholder — it's the template, and
 * editing the task should show what will carry forward — so the substitution
 * happens only at display time.
 */
export function displayTitle(title: string, counter: number | null): string {
  if (counter == null) return title;
  return title.replace(/\{n\}/g, String(counter));
}
