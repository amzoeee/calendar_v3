import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedBotRequest, setMarkerPreference } from '@/lib/discord-link';

// Set by the bot's /marker. Per Discord account, so one person wanting the
// watermark doesn't impose it on everyone else sharing the bot.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { discordUserId?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId : '';
  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const linked = await setMarkerPreference(discordUserId, body.enabled);
  if (!linked) {
    return NextResponse.json({ error: 'not_linked' }, { status: 403 });
  }

  return NextResponse.json({ postMarker: body.enabled });
}
