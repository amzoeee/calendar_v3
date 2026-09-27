import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedBotRequest, resolveLinkedUser } from '@/lib/discord-link';
import { stageLogForUser } from '@/lib/discord-log';
import { recordStage } from '@/lib/discord-markers';
import { dayStrOfInstant, SERVER_TIMEZONE } from '@/lib/timezone';

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
    fallbackAt?: unknown;
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
  // An instant, not a date: which calendar day the oldest scraped message
  // falls on depends on the zone, which only the link knows.
  const fallbackAt = typeof body.fallbackAt === 'string' ? Date.parse(body.fallbackAt) : NaN;

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

  // Discord exposes no timezone, so the link carries the one from the browser
  // that established it. Links made before that was recorded read as the
  // server's zone, which is what the whole app did until now.
  const timeZone = link.timeZone || SERVER_TIMEZONE;
  const fallbackDate = Number.isNaN(fallbackAt) ? null : dayStrOfInstant(fallbackAt, timeZone);

  const result = await stageLogForUser(link.userId, text, dateOverride, timeZone, fallbackDate);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Only once the user approves does this channel get its marker.
  if (channelId) await recordStage(link.userId, channelId);

  revalidatePath('/calendar', 'layout');
  return NextResponse.json({
    username: link.username,
    timeZone,
    count: result.count,
    dateUsed: result.dateUsed,
    warnings: result.warnings,
  });
}
