import { NextRequest, NextResponse } from 'next/server';
import { createLinkCode, isAuthorizedBotRequest, resolveLinkedUser } from '@/lib/discord-link';

// Called by the bot when someone runs /link. The code it returns is shown to
// that Discord user privately; redeeming it happens in the calendar's settings
// page, which is what ties the code back to a calendar account.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { discordUserId?: unknown; discordUsername?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId : '';
  const discordUsername = typeof body.discordUsername === 'string' ? body.discordUsername : null;
  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
  }

  const existing = await resolveLinkedUser(discordUserId);
  const { code, expiresAt } = await createLinkCode(discordUserId, discordUsername);

  return NextResponse.json({
    code,
    expiresAt,
    // Non-null when re-linking, so the bot can warn that finishing this
    // replaces the account they are already pointed at.
    currentUsername: existing?.username ?? null,
  });
}

// Lets the bot answer "which calendar account am I posting to?" without
// issuing a code.
export async function GET(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discordUserId = new URL(request.url).searchParams.get('discordUserId');
  if (!discordUserId) {
    return NextResponse.json({ error: 'discordUserId is required' }, { status: 400 });
  }

  const link = await resolveLinkedUser(discordUserId);
  return NextResponse.json({ linked: link !== null, username: link?.username ?? null });
}
