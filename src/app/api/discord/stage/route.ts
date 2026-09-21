import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedBotRequest, resolveLinkedUser } from '@/lib/discord-link';
import { stageLogForUser } from '@/lib/discord-log';
import { recordStage } from '@/lib/discord-markers';
import { SERVER_TIMEZONE } from '@/lib/timezone';

// Called by the bot's /fetch with the log text it scraped out of a channel.
// Everything lands as pending, exactly like a pasted log — nothing reaches the
// calendar proper until the user approves it in the web UI.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    discordUserId?: unknown;
    channelId?: unknown;
    text?: unknown;
    dateOverride?: unknown;
    fallbackDate?: unknown;
    timeZone?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const dateOverride = typeof body.dateOverride === 'string' && body.dateOverride ? body.dateOverride : null;
  const fallbackDate = typeof body.fallbackDate === 'string' && body.fallbackDate ? body.fallbackDate : null;
  const timeZone = typeof body.timeZone === 'string' && body.timeZone ? body.timeZone : SERVER_TIMEZONE;

  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const link = await resolveLinkedUser(discordUserId);
  if (!link) {
    return NextResponse.json({ error: 'not_linked' }, { status: 403 });
  }

  const result = await stageLogForUser(link.userId, text, dateOverride, timeZone, fallbackDate);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Only once the user approves does this channel get its marker.
  if (channelId) await recordStage(link.userId, channelId);

  revalidatePath('/calendar', 'layout');
  return NextResponse.json({
    username: link.username,
    count: result.count,
    dateUsed: result.dateUsed,
    warnings: result.warnings,
  });
}
