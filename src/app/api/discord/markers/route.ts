import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedBotRequest } from '@/lib/discord-link';
import { acknowledgeStages, listApprovedStages } from '@/lib/discord-markers';

// The bot polls this for batches the user has approved, posts a `---` in each
// channel, then acknowledges them below. Polling rather than a callback keeps
// every connection pointing bot -> app, so the bot needs no inbound port.
export async function GET(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ markers: await listApprovedStages() });
}

// Acknowledged only after the marker is actually posted, so a channel the bot
// can't reach right now is retried on the next poll rather than dropped.
export async function POST(request: NextRequest) {
  if (!isAuthorizedBotRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'number') : [];
  await acknowledgeStages(ids);

  return NextResponse.json({ acknowledged: ids.length });
}
