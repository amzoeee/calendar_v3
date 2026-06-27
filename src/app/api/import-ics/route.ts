import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { parseIcsContent } from '@/lib/ics';
import { createRecurringEvent } from '@/lib/recurring';
import { db } from '@/db';
import { events } from '@/db/schema';

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
      return NextResponse.redirect(new URL('/settings?error=No+file+uploaded', request.url));
    }

    if (!file.name.endsWith('.ics')) {
      return NextResponse.redirect(new URL('/settings?error=Please+upload+a+.ics+file', request.url));
    }

    const textContent = await file.text();
    const parsedEvents = parseIcsContent(textContent);

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

    return NextResponse.redirect(new URL(`/settings?success=Successfully+imported+${count}+events!`, request.url));
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/settings?error=Error+importing+file:+${encodeURIComponent(e.message || '')}`, request.url)
    );
  }
}
