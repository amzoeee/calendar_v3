import { db } from '@/db';
import { events as eventsTable } from '@/db/schema';
import { and, asc, eq, gte, lt, lte } from 'drizzle-orm';
import { getTags } from '@/features/tags/server/queries';
import { buildMatchIndex, EXACT, matchEvents, RELATED, type Focus, type LifetimeEvents } from '@/lib/lifetime';
import { dateToServerDbString, dayStrOfInstant, dbStringToUtcMillis } from '@/lib/timezone';
import { normalizeTitle } from '@/lib/titleParts';
import { formatToolTime } from './time';

const MS_PER_MIN = 60_000;
const TOP_TITLES = 10;

export type GroupBy = 'day' | 'week' | 'month';

interface Row {
  id: number;
  start: string;
  title: string;
  minutes: number;
}

// Matches the Lifetime page: titles interned by normalised form and shown in
// their most common spelling, durations cut off at now.
async function loadRange(userId: number, startDb: string, endDb: string) {
  const nowStr = dateToServerDbString(new Date());
  const nowMin = Math.floor(Date.now() / MS_PER_MIN);
  const tags = await getTags(userId);
  const rows = await db
    .select({
      id: eventsTable.id,
      start: eventsTable.startDatetime,
      end: eventsTable.endDatetime,
      title: eventsTable.title,
      tag: eventsTable.tag,
    })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        eq(eventsTable.isPending, 0),
        gte(eventsTable.startDatetime, startDb),
        lt(eventsTable.startDatetime, endDb),
        lte(eventsTable.startDatetime, nowStr),
      ),
    )
    .orderBy(asc(eventsTable.startDatetime));

  const titleIndex = new Map<string, number>();
  const spellings: Map<string, number>[] = [];
  const tagNames = tags.map((t) => t.name);
  const tagIndex = new Map(tagNames.map((n, i) => [n, i]));
  const data: LifetimeEvents = { titles: [], tagNames, ids: [], starts: [], durations: [], titleIdx: [], tagIdx: [] };

  for (const r of rows) {
    const startMin = Math.floor(dbStringToUtcMillis(r.start) / MS_PER_MIN);
    const endMin = Math.min(Math.floor(dbStringToUtcMillis(r.end) / MS_PER_MIN), nowMin);
    const key = normalizeTitle(r.title);
    let ti = titleIndex.get(key);
    if (ti === undefined) {
      ti = spellings.length;
      titleIndex.set(key, ti);
      spellings.push(new Map());
    }
    const s = spellings[ti];
    s.set(r.title.trim(), (s.get(r.title.trim()) ?? 0) + 1);

    data.ids.push(r.id);
    data.starts.push(startMin);
    data.durations.push(Math.max(0, endMin - startMin));
    data.titleIdx.push(ti);
    data.tagIdx.push(r.tag ? (tagIndex.get(r.tag) ?? -1) : -1);
  }
  data.titles = spellings.map((s) => [...s.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  const byId = new Map(rows.map((r) => [r.id, r.start]));
  return { data, tags, byId };
}

function titleBreakdown(rows: Row[]) {
  const byTitle = new Map<string, { title: string; count: number; minutes: number }>();
  for (const r of rows) {
    const entry = byTitle.get(r.title) ?? { title: r.title, count: 0, minutes: 0 };
    entry.count++;
    entry.minutes += r.minutes;
    byTitle.set(r.title, entry);
  }
  return [...byTitle.values()].sort((a, b) => b.minutes - a.minutes).slice(0, TOP_TITLES);
}

function summarize(rows: Row[], timeZone: string) {
  if (rows.length === 0) return { count: 0, total_minutes: 0 };
  const mins = rows.map((r) => r.minutes).sort((a, b) => a - b);
  const total = mins.reduce((a, b) => a + b, 0);
  const mid = mins.length >> 1;
  const longest = rows.reduce((best, r) => (r.minutes > best.minutes ? r : best));
  return {
    count: rows.length,
    total_minutes: total,
    average_minutes: Math.round(total / rows.length),
    median_minutes: mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2,
    longest: { id: longest.id, title: longest.title, start: formatToolTime(longest.start, timeZone), minutes: longest.minutes },
    first: formatToolTime(rows[0].start, timeZone),
    last: formatToolTime(rows[rows.length - 1].start, timeZone),
    titles: titleBreakdown(rows),
  };
}

function periodOf(dbStart: string, groupBy: GroupBy, timeZone: string): string {
  const day = dayStrOfInstant(dbStringToUtcMillis(dbStart), timeZone);
  if (groupBy === 'day') return day;
  if (groupBy === 'month') return day.slice(0, 7);
  const [y, m, d] = day.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const sinceMonday = (new Date(utc).getUTCDay() + 6) % 7;
  return new Date(utc - sinceMonday * 86_400_000).toISOString().slice(0, 10);
}

function grouped(rows: Row[], groupBy: GroupBy, timeZone: string) {
  const periods = new Map<string, { period: string; count: number; minutes: number }>();
  for (const r of rows) {
    const period = periodOf(r.start, groupBy, timeZone);
    const entry = periods.get(period) ?? { period, count: 0, minutes: 0 };
    entry.count++;
    entry.minutes += r.minutes;
    periods.set(period, entry);
  }
  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export async function timeStats(
  userId: number,
  timeZone: string,
  opts: { query?: string; tag?: string; includeSubtags: boolean; startDb: string; endDb: string; groupBy?: GroupBy },
) {
  const { data, tags, byId } = await loadRange(userId, opts.startDb, opts.endDb);

  let focus: Focus;
  if (opts.tag) {
    const wanted = opts.tag.trim().toLowerCase();
    const tag = tags.find((t) => t.name.toLowerCase() === wanted);
    if (!tag) throw new Error(`No tag named "${opts.tag}". Call list_tags for the names.`);
    const at = (id: number) => tags.findIndex((t) => t.id === id);
    focus = {
      kind: 'tag',
      tag: at(tag.id),
      subtags: tags.filter((t) => t.parentId === tag.id).map((t) => at(t.id)),
      withSubtags: opts.includeSubtags,
    };
  } else {
    focus = { kind: 'query', q: opts.query ?? '' };
  }

  const levels = matchEvents(data, buildMatchIndex(data), focus);
  const exact: Row[] = [];
  const related: Row[] = [];
  levels.forEach((lvl, e) => {
    if (lvl !== EXACT && lvl !== RELATED) return;
    const row = { id: data.ids[e], start: byId.get(data.ids[e])!, title: data.titles[data.titleIdx[e]], minutes: data.durations[e] };
    (lvl === EXACT ? exact : related).push(row);
  });

  return {
    exact: {
      ...summarize(exact, timeZone),
      ...(opts.groupBy ? { by_period: grouped(exact, opts.groupBy, timeZone) } : {}),
    },
    // Only a text query has related matches: titles that contain it, like "get ready + drive" for "drive".
    ...(focus.kind === 'query' ? { related: summarize(related, timeZone) } : {}),
  };
}
