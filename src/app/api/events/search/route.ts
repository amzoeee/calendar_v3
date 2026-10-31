import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { searchEvents } from '@/features/events/server/queries';

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

  // Pagination: fixed page size, client requests further pages by `offset`.
  const PAGE_SIZE = 25;
  const parsedOffset = parseInt(searchParams.get('offset') || '0', 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  try {
    const result = await searchEvents(session.userId, q, PAGE_SIZE, offset);

    return NextResponse.json({ events: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
