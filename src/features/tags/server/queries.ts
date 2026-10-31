import { db } from '@/db';
import { tags as tagsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function getTags(userId: number) {
  return db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.userId, userId))
    .orderBy(tagsTable.orderIndex);
}
