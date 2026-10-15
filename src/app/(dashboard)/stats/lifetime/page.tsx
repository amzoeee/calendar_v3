import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { and, asc, eq, lte } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import LifetimeClient from './LifetimeClient';
import { dateToServerDbString, dbStringToUtcMillis } from '@/lib/timezone';
import { normalizeTitle } from '@/lib/titleParts';
import type { LifetimeEvents } from '@/lib/lifetime';
import { todayForViewer } from '@/lib/server-timezone';
import { getNameMatching } from '@/lib/server-name-matching';

const MS_PER_MIN = 60_000;

export default async function LifetimePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const now = new Date();
  const nowStr = dateToServerDbString(now);
  const nowMin = Math.floor(now.getTime() / MS_PER_MIN);

  const dbTags = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.userId, session.userId))
    .orderBy(tagsTable.orderIndex);

  // Future events are left out; the chart ends today.
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
        eq(eventsTable.userId, session.userId),
        eq(eventsTable.isPending, 0),
        lte(eventsTable.startDatetime, nowStr),
      ),
    )
    .orderBy(asc(eventsTable.startDatetime));

  // Titles are interned by their normalised form and shown in whichever
  // spelling was used most, which keeps the payload small and lets
  // "Drive" and "drive " count as one name.
  const titleIndex = new Map<string, number>();
  const spellings: Map<string, number>[] = [];
  const tagNames: string[] = dbTags.map((t) => t.name);
  const tagIndex = new Map(tagNames.map((n, i) => [n, i]));

  const data: LifetimeEvents = {
    titles: [],
    tagNames,
    ids: [],
    starts: [],
    durations: [],
    titleIdx: [],
    tagIdx: [],
  };

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

    // An event whose tag was since deleted still needs a slot.
    let gi = -1;
    if (r.tag) {
      gi = tagIndex.get(r.tag) ?? -1;
      if (gi === -1) {
        gi = tagNames.length;
        tagNames.push(r.tag);
        tagIndex.set(r.tag, gi);
      }
    }

    data.ids.push(r.id);
    data.starts.push(startMin);
    data.durations.push(Math.max(0, endMin - startMin));
    data.titleIdx.push(ti);
    data.tagIdx.push(gi);
  }

  data.titles = spellings.map(
    (s) => [...s.entries()].sort((a, b) => b[1] - a[1])[0][0],
  );

  return (
    <LifetimeClient
      data={data}
      tags={dbTags}
      todayStr={await todayForViewer()}
      nameMatching={await getNameMatching(session.userId)}
    />
  );
}
