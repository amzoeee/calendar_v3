import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { track } from '@/lib/usage';
import { isUsageName, type UsageProps } from '@/lib/usage-catalog';

// Receives `track()` beacons from the browser. Only catalogued names and small
// flat props are kept, so this can't be used to store arbitrary text.
function cleanProps(raw: unknown): UsageProps | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const props: UsageProps = {};
  for (const [key, value] of Object.entries(raw).slice(0, 8)) {
    if (key.length > 32) continue;
    if (typeof value === 'boolean' || typeof value === 'number') props[key] = value;
    else if (typeof value === 'string' && value.length <= 32) props[key] = value;
  }
  return Object.keys(props).length ? props : undefined;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });

  let body: { name?: unknown; props?: unknown };
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!isUsageName(body.name)) return new NextResponse(null, { status: 400 });

  track(session.userId, body.name, cleanProps(body.props));
  return new NextResponse(null, { status: 204 });
}
