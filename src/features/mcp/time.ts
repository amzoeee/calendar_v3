import {
  browserDatetimeToServerDbString,
  convertDbString,
  dateToServerDbString,
  dbStringToUtcMillis,
  SERVER_TIMEZONE,
} from '@/lib/timezone';

// Tool times are ISO strings in the token's zone; the DB holds Pacific wall clock.

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/;
const HAS_OFFSET = /T.*(Z|[+-]\d{2}:?\d{2})$/i;

/** Reads `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` (in `timeZone`) or ISO with an offset into a DB string. */
export function parseToolTime(input: string, timeZone: string): string {
  const s = input.trim();
  if (HAS_OFFSET.test(s)) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) throw new Error(`Can't read "${input}" as a time.`);
    return dateToServerDbString(new Date(ms));
  }
  const m = WALL_CLOCK.exec(s);
  if (!m) throw new Error(`Can't read "${input}" as a time. Use YYYY-MM-DDTHH:MM or YYYY-MM-DD.`);
  return browserDatetimeToServerDbString(`${m[1]}T${m[2] ?? '00:00'}`, timeZone);
}

/** A DB string as `YYYY-MM-DDTHH:MM±HH:MM` in `timeZone`. */
export function formatToolTime(dbString: string, timeZone: string): string {
  const ms = dbStringToUtcMillis(dbString);
  const local = convertDbString(dbString, SERVER_TIMEZONE, timeZone);
  const [date, time] = local.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, sec] = time.split(':').map(Number);
  const offsetMin = Math.round((Date.UTC(y, mo - 1, d, h, mi, sec) - ms) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${time.slice(0, 5)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function nowContext(timeZone: string) {
  const now = new Date();
  return {
    now: formatToolTime(dateToServerDbString(now), timeZone),
    weekday: now.toLocaleDateString('en-US', { weekday: 'long', timeZone }),
    timezone: timeZone,
  };
}
