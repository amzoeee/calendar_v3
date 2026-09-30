import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

// Polled by <PendingSync> so a batch staged from somewhere else — the Discord
// bot, another tab — shows up without a manual reload.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

  return NextResponse.json({ count: rows[0]?.count ?? 0 });
}
