import { db } from '@/db';
import { events } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

// Session-free event writes, shared by the server actions and the MCP tools.
// Times are DB strings (Pacific wall clock); callers convert first.

export type EventRow = typeof events.$inferSelect;

export interface EventFields {
  title: string;
  description: string | null;
  tag: string | null;
  startDatetime: string;
  endDatetime: string;
}

export async function insertEventForUser(userId: number, fields: EventFields): Promise<EventRow> {
  const [row] = await db
    .insert(events)
    .values({ ...fields, userId, isPending: 0 })
    .returning();
  return row;
}

/** Returns the updated row, or undefined when the event isn't the user's. */
export async function updateEventForUser(
  userId: number,
  id: number,
  fields: Partial<EventFields>,
): Promise<EventRow | undefined> {
  const [row] = await db
    .update(events)
    .set(fields)
    .where(and(eq(events.id, id), eq(events.userId, userId)))
    .returning();
  return row;
}

/** Returns the deleted rows, so they can be put back. */
export async function deleteEventsForUser(userId: number, ids: number[]): Promise<EventRow[]> {
  if (ids.length === 0) return [];
  return db
    .delete(events)
    .where(and(eq(events.userId, userId), inArray(events.id, ids)))
    .returning();
}
