'use server';

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';

// Sets a random temporary password and returns it once, for the admin to pass
// on. The user then changes it in settings.
export async function resetPasswordAction(userId: number): Promise<{ password: string } | { error: string }> {
  await requireAdmin();

  const password = crypto.randomBytes(9).toString('base64url');
  const updated = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (updated.length === 0) return { error: 'No such user' };
  return { password };
}
