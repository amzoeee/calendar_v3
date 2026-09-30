import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedBotRequest, resolveLinkedUser } from '@/lib/discord-link';
import { discardPendingForUser } from '@/lib/discord-log';

// Called by the bot's /clear and the button under a /fetch reply. Same effect
// as discarding in the web UI, so no marker gets posted for these.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { discordUserId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId : '';
  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
  }

  const link = await resolveLinkedUser(discordUserId);
  if (!link) {
    return NextResponse.json({ error: 'not_linked' }, { status: 403 });
  }

  const count = await discardPendingForUser(link.userId);
  if (count > 0) revalidatePath('/calendar', 'layout');
  return NextResponse.json({ username: link.username, count });
}
