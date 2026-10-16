import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedBotRequest, resolveLinkedUser } from '@/lib/discord-link';
import { track } from '@/lib/usage';
import { isUsageName, type UsageProps } from '@/lib/usage-catalog';

// The bot reports every command and button press here. Unlinked Discord
// accounts are recorded without a user.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { discordUserId?: unknown; command?: unknown; options?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const name = typeof body.command === 'string' ? `bot.${body.command.replace(/-/g, '_')}` : '';
  if (!isUsageName(name)) {
    return NextResponse.json({ error: 'unknown command' }, { status: 400 });
  }

  const link = typeof body.discordUserId === 'string' ? await resolveLinkedUser(body.discordUserId) : null;

  // Which options were given, not their values.
  const options = Array.isArray(body.options)
    ? body.options.filter((o): o is string => typeof o === 'string' && o.length <= 32).slice(0, 8)
    : [];
  const props: UsageProps = Object.fromEntries(options.map((o) => [o, true]));

  track(link?.userId ?? null, name, options.length ? props : undefined);
  return new NextResponse(null, { status: 204 });
}
