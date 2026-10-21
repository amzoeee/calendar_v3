import { db } from '@/db';
import { taskBoards } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * The board every account is guaranteed to have. Accounts created before tasks
 * existed have none, so the tasks page calls this on load rather than relying
 * on registration having seeded one.
 */
export async function ensureDefaultBoard(userId: number): Promise<number> {
  const [existing] = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(eq(taskBoards.userId, userId))
    // The chosen default first, then the top of the rail for an account that
    // has never picked one.
    .orderBy(desc(taskBoards.isDefault), taskBoards.orderIndex)
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(taskBoards)
    .values({ name: 'My Tasks', orderIndex: 1, userId })
    .returning({ id: taskBoards.id });

  return created.id;
}
