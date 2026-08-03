import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events } from '@/db/schema';
import { eq, and, or, like, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  if (!q) {
    return NextResponse.json({ events: [] });
  }

  const pattern = `%${q}%`;

  try {
    const result = await db
      .select({
        id: events.id,
        title: events.title,
        startDatetime: events.startDatetime,
        endDatetime: events.endDatetime,
        tag: events.tag,
      })
      .from(events)
      .where(
        and(
          eq(events.userId, session.userId),
          eq(events.isPending, 0),
          or(
            like(events.title, pattern),
            like(events.description, pattern),
            like(events.tag, pattern)
          )
        )
      )
      .orderBy(desc(events.startDatetime))
      .limit(25);

    return NextResponse.json({ events: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
