import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_NAME_MATCHING, parseNameMatching, type NameMatching } from './titleParts';

// Defaults on any failure, including a push-built database that doesn't have
// the table yet — matching titles isn't worth breaking a page over.
export async function getNameMatching(userId: number): Promise<NameMatching> {
  try {
    const [row] = await db
      .select({ nameMatching: userPreferences.nameMatching })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row?.nameMatching ? parseNameMatching(JSON.parse(row.nameMatching)) : DEFAULT_NAME_MATCHING;
  } catch {
    return DEFAULT_NAME_MATCHING;
  }
}
