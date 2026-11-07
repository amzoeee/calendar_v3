'use server';

import { db } from '@/db';
import { users, tags, taskBoards } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { todayForViewer } from '@/lib/server-timezone';
import { track } from '@/lib/usage';

export async function registerAction(prevState: any, formData: FormData) {
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!username || !password) {
    return { error: 'Username and password are required' };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match' };
  }

  try {
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return { error: `Username '${username}' already exists` };
    }

    const passwordHash = await hashPassword(password);
    
    // Insert user
    const [newUser] = await db
      .insert(users)
      .values({ username, passwordHash })
      .returning({ id: users.id });

    // Initialize default tags
    const defaultTags = [
      { name: 'Work', color: '#007bff', orderIndex: 1, userId: newUser.id },
      { name: 'Personal', color: '#28a745', orderIndex: 2, userId: newUser.id },
      { name: 'Social', color: '#ffc107', orderIndex: 3, userId: newUser.id },
      { name: 'Important', color: '#dc3545', orderIndex: 4, userId: newUser.id },
    ];
    await db.insert(tags).values(defaultTags);

    // Give the account a task list to land on. Accounts that predate tasks get
    // theirs lazily instead — see ensureDefaultBoard in features/tasks/server.
    await db.insert(taskBoards).values({ name: 'My Tasks', orderIndex: 1, userId: newUser.id });

    await createSession(newUser.id, username);
    track(newUser.id, 'auth.register');
  } catch (e: any) {
    return { error: e.message || 'Registration failed' };
  }

  const today = await todayForViewer();
  redirect(`/calendar/${today}`);
}

export async function loginAction(prevState: any, formData: FormData) {
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;

  if (!username || !password) {
    return { error: 'Username and password are required' };
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      return { error: 'Invalid username or password' };
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return { error: 'Invalid username or password' };
    }

    await createSession(user.id, user.username);
    track(user.id, 'auth.login');
  } catch (e: any) {
    return { error: e.message || 'Login failed' };
  }

  const today = await todayForViewer();
  redirect(`/calendar/${today}`);
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}

export async function changePasswordAction(currentPassword: string, newPassword: string) {
  const session = await requireAuth();
  track(session.userId, 'account.change_password');

  if (!currentPassword || !newPassword) {
    return { error: 'Current and new password are required' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: 'Current password is incorrect' };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, session.userId));

  return { success: true };
}
