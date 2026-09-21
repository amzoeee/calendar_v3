import { cookies } from 'next/headers';
import { parseWeekStart, WEEK_START_COOKIE, type WeekStart } from './week';

// The `weekStart` cookie is written from Settings. Absent — a viewer who has
// never changed it — means the default, Sunday.
export async function getWeekStart(): Promise<WeekStart> {
  return parseWeekStart((await cookies()).get(WEEK_START_COOKIE)?.value);
}
