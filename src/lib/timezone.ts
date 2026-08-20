// The server (and the DB) always stores/interprets wall-clock strings as Pacific time.
// Browsers can be in any timezone, so form input needs to be converted from the
// browser's timezone to Pacific before it's treated as the app's "local" time.
export const SERVER_TIMEZONE = 'America/Los_Angeles';

// Constructing an Intl.DateTimeFormat is expensive — it dominated the cost of
// every date conversion here, and the calendar views convert two dates per
// event on each render. The instances are stateless and safe to reuse, so
// they're built once per (locale + options + timeZone) and cached.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${options.hour ? 'dt' : 'd'}`;
  let dtf = formatterCache.get(key);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatterCache.set(key, dtf);
  }
  return dtf;
}

const DATE_TIME_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

const DATE_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

function getOffsetMillis(utcMillis: number, timeZone: string): number {
  const dtf = getFormatter('en-US', timeZone, DATE_TIME_PARTS);
  const parts = dtf.formatToParts(new Date(utcMillis));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asUtc - utcMillis;
}

// Given a wall-clock "YYYY-MM-DDTHH:MM" string meant as local time in `timeZone`,
// return the UTC instant it refers to (DST-correct via Intl).
function zonedDatetimeToUtcMillis(dateTimeLocal: string, timeZone: string): number {
  const [datePart, timePart] = dateTimeLocal.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = (timePart || '00:00').split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  const offset1 = getOffsetMillis(guess, timeZone);
  let utcMillis = guess - offset1;
  const offset2 = getOffsetMillis(utcMillis, timeZone);
  if (offset2 !== offset1) {
    utcMillis = guess - offset2;
  }
  return utcMillis;
}

// Format a UTC instant as a "YYYY-MM-DD HH:MM:SS" wall-clock string in `timeZone`.
function utcMillisToDbString(utcMillis: number, timeZone: string): string {
  const dtf = getFormatter('en-CA', timeZone, DATE_TIME_PARTS);
  const parts = dtf.formatToParts(new Date(utcMillis));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second}`;
}

// Convert a "YYYY-MM-DDTHH:MM" value from a <input type="date">/<input type="time">
// pair, entered in `browserTimeZone`, into a "YYYY-MM-DD HH:MM:SS" string in the
// server's timezone (Pacific), suitable for storage in the DB.
export function browserDatetimeToServerDbString(dateTimeLocal: string, browserTimeZone: string): string {
  const utcMillis = zonedDatetimeToUtcMillis(dateTimeLocal, browserTimeZone || SERVER_TIMEZONE);
  return utcMillisToDbString(utcMillis, SERVER_TIMEZONE);
}

// Convert a "YYYY-MM-DD HH:MM:SS" DB string (stored in `fromTimeZone`) into the
// equivalent wall-clock string in `toTimeZone`.
export function convertDbString(dbString: string, fromTimeZone: string, toTimeZone: string): string {
  const dateTimeLocal = dbString.replace(' ', 'T');
  const utcMillis = zonedDatetimeToUtcMillis(dateTimeLocal, fromTimeZone);
  return utcMillisToDbString(utcMillis, toTimeZone);
}

// UTC instant (ms) that a Pacific-stored "YYYY-MM-DD HH:MM:SS" DB string refers to.
export function dbStringToUtcMillis(dbString: string, fromTimeZone: string = SERVER_TIMEZONE): number {
  const dateTimeLocal = dbString.replace(' ', 'T');
  return zonedDatetimeToUtcMillis(dateTimeLocal, fromTimeZone);
}

// UTC instant (ms) that a "YYYY-MM-DDTHH:MM" wall-clock value refers to when
// read as local time in `timeZone`.
export function instantForWallClock(dateTimeLocal: string, timeZone: string): number {
  return zonedDatetimeToUtcMillis(dateTimeLocal, timeZone);
}

// "YYYY-MM-DD" calendar day that a UTC instant falls on, as observed in `timeZone`.
export function dayStrOfInstant(ms: number, timeZone: string): string {
  return getFormatter('en-CA', timeZone, DATE_PARTS).format(new Date(ms));
}

// A real Date instant for a Pacific-stored DB string. Since Date getters
// (getHours/getDate/toLocaleTimeString/...) always report the *host's* local
// time, calling this in the browser and using those getters on the result
// automatically displays the event in the viewer's own timezone.
export function pacificDbStringToDate(dbString: string): Date {
  return new Date(dbStringToUtcMillis(dbString, SERVER_TIMEZONE));
}

// Format a real Date instant as a "YYYY-MM-DD HH:MM:SS" Pacific DB string.
// Unlike calling .getHours() etc. directly, this is correct regardless of
// what timezone the server host's own clock happens to be set to.
export function dateToServerDbString(d: Date): string {
  return utcMillisToDbString(d.getTime(), SERVER_TIMEZONE);
}

// Add N calendar days to a "YYYY-MM-DD" string. Pure calendar arithmetic —
// no timezone involved, since a date-only string has no instant to convert.
export function shiftDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// "YYYY-MM-DD" for `Date.now() + dayOffsetDays * 24h`, as observed in `timeZone`.
export function dateStrInTimeZone(timeZone: string, dayOffsetDays: number = 0): string {
  const ms = Date.now() + dayOffsetDays * 24 * 60 * 60 * 1000;
  return getFormatter('en-CA', timeZone, DATE_PARTS).format(new Date(ms));
}

// Detects the current browser's IANA timezone (e.g. "America/New_York").
export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return SERVER_TIMEZONE;
  }
}

// "YYYY-MM-DD" date-input value for a Date, using the host's local getters.
export function formatDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "HH:MM" time-input value for a Date, using the host's local getters.
export function formatTimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Human label for an event's time range, as observed in the host's local
// timezone. Same-day events read "10:00 PM - 11:30 PM"; events that cross
// midnight carry a date on each end ("Aug 12 10:00 PM - Aug 13 07:00 AM") so
// a copy of the event rendered on each day it spans is still unambiguous
// about when it actually starts and ends. No weekday — the agenda row already
// sits under a day header, so it would only cost width.
export function formatEventTimeRange(start: Date, end: Date): string {
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (start.toDateString() === end.toDateString()) {
    return `${time(start)} - ${time(end)}`;
  }
  const dateLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateLabel(start)} ${time(start)} - ${dateLabel(end)} ${time(end)}`;
}

// Add N hours to a "YYYY-MM-DD HH:MM:SS" DB string (plain wall-clock arithmetic,
// no timezone lookup needed since it never crosses timezones).
export function addHoursToDbString(dbString: string, hours: number): string {
  const [datePart, timePart] = dbString.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) + hours * 60 * 60 * 1000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
