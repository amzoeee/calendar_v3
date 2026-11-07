import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getApprovedEvents } from '@/features/events/server/queries';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tag = searchParams.get('tag');

  try {
    const result = await getApprovedEvents(session.userId, tag);

    return NextResponse.json({ events: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch events' }, { status: 500 });
  }
}
