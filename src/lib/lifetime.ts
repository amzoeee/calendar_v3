// Client-side model for the lifetime chart: one column per day, events split
// into per-day segments, plus title matching and the per-name stats.

import { normalizeTitle, titleParts } from './titleParts';
import type { WeekStart } from './week';

// Hour each column starts at.
export const DAY_START_HOUR = 0;
export const MINUTES_PER_DAY = 1440;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
// Guards against a runaway (mistyped) event filling weeks of columns.
const MAX_SPLIT_DAYS = 14;

export interface LifetimeEvents {
  titles: string[];
  tagNames: string[];
  ids: number[];
  // Minutes since the Unix epoch.
  starts: number[];
  durations: number[];
  titleIdx: number[];
  // -1 for untagged.
  tagIdx: number[];
}

export interface Segments {
  day: Int32Array;
  // Minutes since the column's 4am start.
  y0: Float32Array;
  y1: Float32Array;
  event: Int32Array;
  length: number;
  // Column of each event's start.
  eventDay: Int32Array;
}

// Days since the epoch for a local calendar date; UTC so DST can't skew it.
const dayNumber = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / MS_PER_DAY);

// The local 4am-to-4am day an instant falls in.
function columnOf(ms: number) {
  const d = new Date(ms);
  const back = d.getHours() < DAY_START_HOUR ? 1 : 0;
  const y = d.getFullYear();
  const m = d.getMonth();
  const dd = d.getDate() - back;
  return {
    day: dayNumber(y, m, dd),
    startMs: new Date(y, m, dd, DAY_START_HOUR).getTime(),
    nextMs: new Date(y, m, dd + 1, DAY_START_HOUR).getTime(),
  };
}

export const todayColumn = () => columnOf(Date.now()).day;

export function dateOfColumn(day: number): Date {
  const d = new Date(day * MS_PER_DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function buildSegments(data: LifetimeEvents): Segments {
  const day: number[] = [];
  const y0: number[] = [];
  const y1: number[] = [];
  const event: number[] = [];
  const eventDay = new Int32Array(data.starts.length);

  for (let i = 0; i < data.starts.length; i++) {
    let cur = data.starts[i] * MS_PER_MIN;
    const end = cur + data.durations[i] * MS_PER_MIN;
    for (let n = 0; n < MAX_SPLIT_DAYS; n++) {
      const col = columnOf(cur);
      if (n === 0) eventDay[i] = col.day;
      const pieceEnd = Math.min(end, col.nextMs);
      const top = (cur - col.startMs) / MS_PER_MIN;
      day.push(col.day);
      y0.push(top);
      y1.push(Math.min(MINUTES_PER_DAY, Math.max(top, (pieceEnd - col.startMs) / MS_PER_MIN)));
      event.push(i);
      if (end <= col.nextMs) break;
      cur = col.nextMs;
    }
  }

  return {
    day: Int32Array.from(day),
    y0: Float32Array.from(y0),
    y1: Float32Array.from(y1),
    event: Int32Array.from(event),
    length: day.length,
    eventDay,
  };
}

// ---- Range ----------------------------------------------------------------

export type LifetimeRange =
  | { kind: 'all' }
  | { kind: 'year' }
  // Inclusive 'YYYY-MM-DD' dates.
  | { kind: 'custom'; from: string; to: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRange(params: { range?: string; from?: string; to?: string }): LifetimeRange {
  const { range, from, to } = params;
  if (range === 'year') return { kind: 'year' };
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    return from <= to ? { kind: 'custom', from, to } : { kind: 'custom', from: to, to: from };
  }
  return { kind: 'all' };
}

export function rangeSearch(range: LifetimeRange): string {
  if (range.kind === 'year') return '?range=year';
  if (range.kind === 'custom') return `?from=${range.from}&to=${range.to}`;
  return '';
}

export const columnOfDate = (s: string) => dayNumber(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const dateOfColumnStr = (day: number) => dateOfColumn(day).toLocaleDateString('en-CA');

// Columns the range covers, ending no later than today.
export function rangeColumns(range: LifetimeRange, firstEventDay: number, today: number) {
  if (range.kind === 'year') {
    return { firstDay: dayNumber(dateOfColumn(today).getFullYear(), 0, 1), lastDay: today };
  }
  if (range.kind === 'custom') {
    const firstDay = columnOfDate(range.from);
    return { firstDay, lastDay: Math.max(firstDay, Math.min(columnOfDate(range.to), today)) };
  }
  return { firstDay: firstEventDay, lastDay: Math.max(today, firstEventDay) };
}

// Events starting within [firstDay, lastDay]. Titles and tags keep their
// indices so a focus survives a range change.
export function sliceEvents(data: LifetimeEvents, eventDay: Int32Array, firstDay: number, lastDay: number): LifetimeEvents {
  const keep: number[] = [];
  eventDay.forEach((d, e) => {
    if (d >= firstDay && d <= lastDay) keep.push(e);
  });
  return {
    titles: data.titles,
    tagNames: data.tagNames,
    ids: keep.map((e) => data.ids[e]),
    starts: keep.map((e) => data.starts[e]),
    durations: keep.map((e) => data.durations[e]),
    titleIdx: keep.map((e) => data.titleIdx[e]),
    tagIdx: keep.map((e) => data.tagIdx[e]),
  };
}

// ---- Matching -------------------------------------------------------------

export interface MatchIndex {
  keys: string[];
  parts: string[][];
  // Sorted parts, so "[train] dwg" and "dwg" count as the same name.
  signatures: string[];
  titlesByPart: Map<string, number[]>;
  eventsByTitle: number[][];
}

export function buildMatchIndex(data: LifetimeEvents): MatchIndex {
  const keys = data.titles.map(normalizeTitle);
  const parts = data.titles.map(titleParts);
  const signatures = parts.map((ps) => [...ps].sort().join('\u0000'));
  const titlesByPart = new Map<string, number[]>();
  parts.forEach((ps, t) => {
    for (const p of ps) {
      const list = titlesByPart.get(p);
      if (list) list.push(t);
      else titlesByPart.set(p, [t]);
    }
  });
  const eventsByTitle: number[][] = data.titles.map(() => []);
  data.titleIdx.forEach((t, e) => eventsByTitle[t].push(e));
  return { keys, parts, signatures, titlesByPart, eventsByTitle };
}

export type Focus =
  | { kind: 'title'; title: number; part: string | null; event: number | null }
  | { kind: 'query'; q: string }
  | { kind: 'part'; part: string }
  | { kind: 'tag'; tag: number; subtags: number[]; withSubtags: boolean };

export const EXACT = 2;
export const RELATED = 1;

// Per-title match level: EXACT for the name itself, RELATED for titles that
// share one of its parts.
function matchTitles(index: MatchIndex, focus: Exclude<Focus, { kind: 'tag' }>): Uint8Array {
  const levels = new Uint8Array(index.keys.length);
  const markParts = (ps: string[]) => {
    for (const p of ps) for (const t of index.titlesByPart.get(p) ?? []) levels[t] = RELATED;
  };

  if (focus.kind === 'query') {
    const q = normalizeTitle(focus.q);
    if (!q) return levels;
    index.keys.forEach((k, t) => {
      if (k === q || (index.parts[t].length === 1 && index.parts[t][0] === q)) levels[t] = EXACT;
      else if (k.includes(q)) levels[t] = RELATED;
    });
    return levels;
  }

  if (focus.part !== null) {
    markParts([focus.part]);
    for (const t of index.titlesByPart.get(focus.part) ?? []) {
      if (index.parts[t].length === 1) levels[t] = EXACT;
    }
    return levels;
  }
  if (focus.kind === 'part') return levels;

  markParts(index.parts[focus.title]);
  const sig = index.signatures[focus.title];
  if (sig) {
    for (const t of index.titlesByPart.get(index.parts[focus.title][0]) ?? []) {
      if (index.signatures[t] === sig) levels[t] = EXACT;
    }
  }
  levels[focus.title] = EXACT;
  return levels;
}

// Per-event match level. Tags belong to events, not titles, so they can't go
// through matchTitles.
export function matchEvents(data: LifetimeEvents, index: MatchIndex, focus: Focus): Uint8Array {
  if (focus.kind === 'tag') {
    const members = new Set(focus.withSubtags ? [focus.tag, ...focus.subtags] : [focus.tag]);
    return Uint8Array.from(data.tagIdx, (g) => (members.has(g) ? EXACT : 0));
  }
  const titleLevels = matchTitles(index, focus);
  return Uint8Array.from(data.titleIdx, (t) => titleLevels[t]);
}

// ---- Stats ----------------------------------------------------------------

export interface NameStats {
  count: number;
  totalMin: number;
  avgMin: number;
  medianMin: number;
  longestEvent: number;
  firstEvent: number;
  lastEvent: number;
  // Minute of the (midnight-based) day; null when starts are too spread out.
  typicalStartMin: number | null;
  weekdayCounts: number[];
  longestStreak: number;
  longestGapDays: number;
  // Averaged over only the weeks it happened in.
  perWeekMin: number;
  monthly: { month: Date; hours: number }[];
  topTag: { tag: number; share: number } | null;
  // RELATED events, i.e. the name inside combined titles.
  related: { count: number; totalMin: number; titles: { title: number; count: number }[] };
}

export function computeStats(
  data: LifetimeEvents,
  segments: Segments,
  eventLevels: Uint8Array,
  tagTotalMin: Map<number, number>,
  weekStart: WeekStart,
  firstDay: number,
  lastDay: number,
): NameStats | null {
  const exact: number[] = [];
  const related: number[] = [];
  eventLevels.forEach((lvl, e) => {
    if (lvl === EXACT) exact.push(e);
    else if (lvl === RELATED) related.push(e);
  });
  // A substring search can match only combined titles; describe those then.
  const basis = exact.length > 0 ? exact : related;
  if (basis.length === 0) return null;
  basis.sort((a, b) => data.starts[a] - data.starts[b]);

  const durs = basis.map((e) => data.durations[e]);
  const totalMin = durs.reduce((a, b) => a + b, 0);
  const sorted = [...durs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const medianMin = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const longestEvent = basis.reduce((best, e) => (data.durations[e] > data.durations[best] ? e : best));

  // Circular mean, so 11pm and 1am average to midnight rather than noon.
  let sx = 0;
  let sy = 0;
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const e of basis) {
    const d = new Date(data.starts[e] * MS_PER_MIN);
    const a = ((d.getHours() * 60 + d.getMinutes()) / MINUTES_PER_DAY) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
    weekdayCounts[d.getDay()]++;
  }
  const spread = Math.hypot(sx, sy) / basis.length;
  const meanAngle = (Math.atan2(sy, sx) + 2 * Math.PI) % (2 * Math.PI);
  const typicalStartMin = spread < 0.3 ? null : Math.round((meanAngle / (2 * Math.PI)) * MINUTES_PER_DAY);

  const days = [...new Set(basis.map((e) => segments.eventDay[e]))].sort((a, b) => a - b);
  let longestStreak = 1;
  let run = 1;
  let longestGapDays = 0;
  for (let i = 1; i < days.length; i++) {
    const gap = days[i] - days[i - 1];
    run = gap === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    longestGapDays = Math.max(longestGapDays, gap - 1);
  }
  const weeks = new Set(days.map((d) => d - ((dateOfColumn(d).getDay() - weekStart + 7) % 7)));

  // Months across the whole range, not just this name's, so sparklines for
  // different names line up.
  const from = dateOfColumn(firstDay);
  const to = dateOfColumn(lastDay);
  const monthly: NameStats['monthly'] = [];
  for (
    let m = new Date(from.getFullYear(), from.getMonth(), 1);
    m <= to;
    m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
  ) {
    monthly.push({ month: m, hours: 0 });
  }
  const m0 = from.getFullYear() * 12 + from.getMonth();
  for (const e of basis) {
    const d = new Date(data.starts[e] * MS_PER_MIN);
    const slot = monthly[d.getFullYear() * 12 + d.getMonth() - m0];
    if (slot) slot.hours += data.durations[e] / 60;
  }

  const byTag = new Map<number, number>();
  for (const e of basis) {
    const g = data.tagIdx[e];
    if (g >= 0) byTag.set(g, (byTag.get(g) ?? 0) + data.durations[e]);
  }
  const top = [...byTag.entries()].sort((a, b) => b[1] - a[1])[0];
  const topTotal = top ? tagTotalMin.get(top[0]) ?? 0 : 0;
  const topTag = top && topTotal > 0 ? { tag: top[0], share: top[1] / topTotal } : null;

  const relatedEvents = exact.length > 0 ? related : [];
  const relatedTitles = new Map<number, number>();
  for (const e of relatedEvents) {
    const t = data.titleIdx[e];
    relatedTitles.set(t, (relatedTitles.get(t) ?? 0) + 1);
  }

  return {
    count: basis.length,
    totalMin,
    avgMin: totalMin / basis.length,
    medianMin,
    longestEvent,
    firstEvent: basis[0],
    lastEvent: basis[basis.length - 1],
    typicalStartMin,
    weekdayCounts,
    longestStreak,
    longestGapDays,
    perWeekMin: totalMin / weeks.size,
    monthly,
    topTag,
    related: {
      count: relatedEvents.length,
      totalMin: relatedEvents.reduce((a, e) => a + data.durations[e], 0),
      titles: [...relatedTitles.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([title, count]) => ({ title, count })),
    },
  };
}

export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 100) return `${h}h`;
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
