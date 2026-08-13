import { cookies } from 'next/headers';
import { dateStrInTimeZone, SERVER_TIMEZONE } from './timezone';

// The `tz` cookie is mirrored from the browser by <TimezoneSync>. It won't
// exist yet on a user's very first request (e.g. straight to /login), in
// which case we fall back to the server's own timezone.
export async function getViewerTimeZone(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get('tz')?.value || SERVER_TIMEZONE;
}

// "YYYY-MM-DD" for the viewer's current calendar day.
export async function todayForViewer(): Promise<string> {
  return dateStrInTimeZone(await getViewerTimeZone(), 0);
}
