import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { parseIcsContent } from '@/lib/ics';
import { createRecurringEvent } from '@/lib/recurring';
import { db } from '@/db';
import { events } from '@/db/schema';

// Send the browser back to /settings after the multipart form POST.
//
// Deliberately a *relative* Location instead of NextResponse.redirect: that
// helper needs an absolute URL, and the only one available here is built from
// `request.url`, which behind the Caddy reverse proxy is the app's internal
// origin (localhost:4000) rather than the public hostname — so the browser
// was being sent to localhost. A relative Location is resolved against the
// address bar, which is always the real origin.
//
// 303 (not the 307 NextResponse.redirect defaults to) so the browser follows
// up with a GET; a 307 would replay the whole multipart upload at /settings.
function redirectToSettings(params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `/settings?${query}` },
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('ics_file') as File | null;
    const tag = (formData.get('import_tag') as string) || '';

    if (!file || file.name === '') {
      return redirectToSettings({ error: 'No file uploaded' });
    }

    if (!file.name.endsWith('.ics')) {
      return redirectToSettings({ error: 'Please upload a .ics file' });
    }

    const browserTimeZone = (formData.get('browser_tz') as string) || undefined;
    const textContent = await file.text();
    const parsedEvents = parseIcsContent(textContent, browserTimeZone);

    let count = 0;
    for (const event of parsedEvents) {
      if (event.rrule) {
        const { count: recurCount } = await createRecurringEvent(
          event.start_datetime,
          event.end_datetime,
          event.title,
          event.description,
          tag,
          session.userId,
          event.rrule
        );
        count += recurCount;
      } else {
        await db.insert(events).values({
          startDatetime: event.start_datetime,
          endDatetime: event.end_datetime,
          title: event.title,
          description: event.description,
          tag: tag || null,
          userId: session.userId,
          isPending: 0,
        });
        count += 1;
      }
    }

    return redirectToSettings({ success: `Successfully imported ${count} events!` });
  } catch (e: any) {
    return redirectToSettings({ error: `Error importing file: ${e.message || ''}` });
  }
}
