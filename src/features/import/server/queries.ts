import { db } from '@/db';
import { events } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export async function countPendingEvents(userId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.isPending, 1)));

  return rows[0]?.count ?? 0;
}
