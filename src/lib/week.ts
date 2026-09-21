// Which day a week starts on. A viewer preference rather than a property of
// the data, so it lives in a cookie the way the visible board set and the
// browser timezone do — written by the client, read on the server, so the
// first paint already has the right week.

export const WEEK_START_COOKIE = 'weekStart';

/** 0 = Sunday, matching Date#getDay. Only the three in common use are offered. */
export const WEEK_START_OPTIONS = [0, 1, 6] as const;
export type WeekStart = (typeof WEEK_START_OPTIONS)[number];

export const DEFAULT_WEEK_START: WeekStart = 0;

export const WEEK_START_LABELS: Record<WeekStart, string> = {
  0: 'Sunday',
  1: 'Monday',
  6: 'Saturday',
};

export function parseWeekStart(value: string | undefined | null): WeekStart {
  const n = Number(value);
  return (WEEK_START_OPTIONS as readonly number[]).includes(n)
    ? (n as WeekStart)
    : DEFAULT_WEEK_START;
}

/** Midnight on the first day of the week containing `d`. */
export function startOfWeek(d: Date, weekStart: WeekStart): Date {
  const back = (d.getDay() - weekStart + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** The seven weekday numbers in display order, e.g. [1,2,3,4,5,6,0] for Monday. */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}
