import { cookies } from 'next/headers';
import { parseSubtagDisplay, SUBTAG_DISPLAY_COOKIE, type SubtagDisplay } from './tags';

export async function getSubtagDisplay(): Promise<SubtagDisplay> {
  return parseSubtagDisplay((await cookies()).get(SUBTAG_DISPLAY_COOKIE)?.value);
}
