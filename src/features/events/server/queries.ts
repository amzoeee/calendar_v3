import { db } from '@/db';
import { events as eventsTable } from '@/db/schema';
import { eq, and, or, gte, lt, like, desc } from 'drizzle-orm';

/** Every event, pending included, that touches [startStr, endStr). */
export async function getEventsOverlapping(userId: number, startStr: string, endStr: string) {
  return db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        or(
          // Event starts within the range
          and(
            gte(eventsTable.startDatetime, startStr),
            lt(eventsTable.startDatetime, endStr)
          ),
          // Event ends within the range
          and(
            gte(eventsTable.endDatetime, startStr),
            lt(eventsTable.endDatetime, endStr)
          ),
          // Event fully spans the range (starts before, ends after)
          and(
            lt(eventsTable.startDatetime, startStr),
            gte(eventsTable.endDatetime, endStr)
          )
        )
      )
    )
    .orderBy(eventsTable.startDatetime);
}

/** Non-pending events, optionally only those with `tag`. */
export async function getApprovedEvents(userId: number, tag?: string | null) {
  if (tag) {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.userId, userId),
          eq(eventsTable.tag, tag),
          eq(eventsTable.isPending, 0)
        )
      );
  }
  return db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        eq(eventsTable.isPending, 0)
      )
    );
}

/** Newest first; matches `q` in the title, description or tag. */
export async function searchEvents(userId: number, q: string, limit: number, offset: number) {
  const pattern = `%${q}%`;

  return db
    .select({
      id: eventsTable.id,
      title: eventsTable.title,
      startDatetime: eventsTable.startDatetime,
      endDatetime: eventsTable.endDatetime,
      tag: eventsTable.tag,
    })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, userId),
        eq(eventsTable.isPending, 0),
        or(
          like(eventsTable.title, pattern),
          like(eventsTable.description, pattern),
          like(eventsTable.tag, pattern)
        )
      )
    )
    .orderBy(desc(eventsTable.startDatetime))
    .limit(limit)
    .offset(offset);
}

export async function insertApprovedEvent(
  userId: number,
  event: { startDatetime: string; endDatetime: string; title: string; description: string; tag: string | null }
) {
  await db.insert(eventsTable).values({ ...event, userId, isPending: 0 });
}
