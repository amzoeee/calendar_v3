import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { countPendingEvents } from '@/features/import/server/queries';

// Polled by <PendingSync> so a batch staged from somewhere else — the Discord
// bot, another tab — shows up without a manual reload.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  return NextResponse.json({ count: await countPendingEvents(session.userId) });
}
