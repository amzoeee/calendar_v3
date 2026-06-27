import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tag = searchParams.get('tag');

  try {
    let result;
    if (tag) {
      result = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.userId, session.userId),
            eq(events.tag, tag),
            eq(events.isPending, 0)
          )
        );
    } else {
      result = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.userId, session.userId),
            eq(events.isPending, 0)
          )
        );
    }

    return NextResponse.json({ events: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch events' }, { status: 500 });
  }
}
