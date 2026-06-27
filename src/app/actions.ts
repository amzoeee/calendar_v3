'use server';

import { db } from '@/db';
import { users, tags, events } from '@/db/schema';
import { eq, and, asc, desc, sql, ne } from 'drizzle-orm';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAuth,
  getSession,
} from '@/lib/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createRecurringEvent, deleteRecurringSeries, updateRecurringSeries } from '@/lib/recurring';
import { parseLogText, recalculatePendingEventsDate } from '@/lib/discord-log';

// ==========================================
// Authentication Actions
// ==========================================

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

    await createSession(newUser.id, username);
  } catch (e: any) {
    return { error: e.message || 'Registration failed' };
  }

  const today = new Date().toLocaleDateString('en-CA');
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
  } catch (e: any) {
    return { error: e.message || 'Login failed' };
  }

  const today = new Date().toLocaleDateString('en-CA');
  redirect(`/calendar/${today}`);
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}

// ==========================================
// Tag Actions
// ==========================================

export async function addTagAction(name: string, color: string) {
  const session = await requireAuth();
  const trimmedName = name.trim();

  if (!trimmedName) throw new Error('Tag name is required');

  // Check if tag already exists for user
  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.name, trimmedName), eq(tags.userId, session.userId)))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(`Tag '${trimmedName}' already exists`);
  }

  // Get max order index
  const maxResult = await db
    .select({ maxOrder: sql<number>`max(${tags.orderIndex})` })
    .from(tags)
    .where(eq(tags.userId, session.userId));
  
  const orderIndex = (maxResult[0]?.maxOrder || 0) + 1;

  await db.insert(tags).values({
    name: trimmedName,
    color,
    orderIndex,
    userId: session.userId,
  });

  revalidatePath('/settings');
}

export async function updateTagAction(id: number, name: string, color: string) {
  const session = await requireAuth();
  const trimmedName = name.trim();

  if (!trimmedName) throw new Error('Tag name is required');

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)))
    .limit(1);

  if (!tag) throw new Error('Tag not found');

  // If name changed, check uniqueness
  if (tag.name !== trimmedName) {
    const existing = await db
      .select()
      .from(tags)
      .where(and(eq(tags.name, trimmedName), eq(tags.userId, session.userId)))
      .limit(1);
    if (existing.length > 0) {
      throw new Error(`Tag '${trimmedName}' already exists`);
    }
  }

  // Update tag
  await db
    .update(tags)
    .set({ name: trimmedName, color })
    .where(eq(tags.id, id));

  // If name changed, update events using the old name
  if (tag.name !== trimmedName) {
    await db
      .update(events)
      .set({ tag: trimmedName })
      .where(and(eq(events.tag, tag.name), eq(events.userId, session.userId)));
  }

  revalidatePath('/settings');
  revalidatePath('/calendar', 'layout');
}

export async function deleteTagAction(id: number) {
  const session = await requireAuth();

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)))
    .limit(1);

  if (!tag) throw new Error('Tag not found');

  // Set events using this tag to null
  await db
    .update(events)
    .set({ tag: null })
    .where(and(eq(events.tag, tag.name), eq(events.userId, session.userId)));

  // Delete tag
  await db.delete(tags).where(eq(tags.id, id));

  revalidatePath('/settings');
  revalidatePath('/calendar', 'layout');
}

export async function archiveTagAction(id: number) {
  const session = await requireAuth();

  await db
    .update(tags)
    .set({ isArchived: 1 })
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)));

  revalidatePath('/settings');
}

export async function unarchiveTagAction(id: number) {
  const session = await requireAuth();

  await db
    .update(tags)
    .set({ isArchived: 0 })
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)));

  revalidatePath('/settings');
}

export async function reorderTagsAction(tagIds: number[]) {
  const session = await requireAuth();

  for (let index = 0; index < tagIds.length; index++) {
    await db
      .update(tags)
      .set({ orderIndex: index + 1 })
      .where(and(eq(tags.id, tagIds[index]), eq(tags.userId, session.userId)));
  }

  revalidatePath('/settings');
}

// ==========================================
// Event Actions
// ==========================================

export async function addEventAction(data: {
  title: string;
  description: string;
  tag: string;
  startDatetime: string;
  endDatetime: string;
  recurrence: string;
  recurrenceEndDate: string;
}) {
  const session = await requireAuth();
  
  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  // Convert HTML local datetimes (YYYY-MM-DDTHH:MM) to DB format (YYYY-MM-DD HH:MM:SS)
  const startDt = new Date(data.startDatetime);
  let endDt = new Date(data.endDatetime);

  if (endDt <= startDt) {
    endDt = new Date(startDt.getTime() + 60 * 60 * 1000); // default 1 hour
  }

  const formatDb = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };

  const startStr = formatDb(startDt);
  const endStr = formatDb(endDt);

  if (data.recurrence) {
    const rruleParts = [`FREQ=${data.recurrence}`];
    if (data.recurrenceEndDate) {
      const untilDt = new Date(data.recurrenceEndDate);
      const pad = (n: number) => String(n).padStart(2, '0');
      rruleParts.push(`UNTIL=${untilDt.getFullYear()}${pad(untilDt.getMonth() + 1)}${pad(untilDt.getDate())}`);
    }
    const rrule = rruleParts.join(';');

    await createRecurringEvent(startStr, endStr, title, description, tag || '', session.userId, rrule);
  } else {
    await db.insert(events).values({
      startDatetime: startStr,
      endDatetime: endStr,
      title,
      description,
      tag,
      userId: session.userId,
      isPending: 0,
    });
  }

  revalidatePath('/calendar', 'layout');
}

export async function updateEventAction(
  id: number,
  data: {
    title: string;
    description: string;
    tag: string;
    startDatetime: string;
    endDatetime: string;
  }
) {
  const session = await requireAuth();

  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  const startDt = new Date(data.startDatetime);
  let endDt = new Date(data.endDatetime);

  if (endDt <= startDt) {
    endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
  }

  const formatDb = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };

  await db
    .update(events)
    .set({
      title,
      description,
      tag,
      startDatetime: formatDb(startDt),
      endDatetime: formatDb(endDt),
    })
    .where(and(eq(events.id, id), eq(events.userId, session.userId)));

  revalidatePath('/calendar', 'layout');
}

export async function deleteEventAction(id: number) {
  const session = await requireAuth();

  await db.delete(events).where(and(eq(events.id, id), eq(events.userId, session.userId)));

  revalidatePath('/calendar', 'layout');
}

export async function copyEventAction(id: number) {
  const session = await requireAuth();

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.userId, session.userId)))
    .limit(1);

  if (event) {
    await db.insert(events).values({
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      title: event.title,
      description: event.description,
      tag: event.tag,
      userId: session.userId,
      isPending: 0,
    });
  }

  revalidatePath('/calendar', 'layout');
}

export async function deleteRecurringSeriesAction(recurrenceId: string) {
  const session = await requireAuth();
  await deleteRecurringSeries(recurrenceId, session.userId);
  revalidatePath('/calendar', 'layout');
}

export async function updateRecurringSeriesAction(
  recurrenceId: string,
  data: { title: string; description: string; tag: string }
) {
  const session = await requireAuth();
  await updateRecurringSeries(recurrenceId, session.userId, data.title, data.description, data.tag);
  revalidatePath('/calendar', 'layout');
}

// ==========================================
// Discord Log Actions
// ==========================================

export async function stageLogAction(text: string, dateOverride?: string | null) {
  const session = await requireAuth();

  try {
    const hasPendingResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

    if (hasPendingResult[0]?.count > 0) {
      return { error: 'You already have pending events. Please approve or clear them first.' };
    }

    const { events: parsedEvents, dateUsed, warnings } = await parseLogText(
      text,
      session.userId,
      dateOverride
    );

    const valuesToInsert = parsedEvents.map((e) => ({
      startDatetime: e.start,
      endDatetime: e.end,
      title: e.title,
      tag: e.tag || null,
      userId: session.userId,
      isPending: 1,
    }));

    if (valuesToInsert.length > 0) {
      await db.insert(events).values(valuesToInsert);
    }

    revalidatePath('/calendar', 'layout');
    return { success: true, count: valuesToInsert.length, dateUsed, warnings };
  } catch (e: any) {
    return { error: e.message || 'Log staging failed' };
  }
}

export async function approveAllPendingAction() {
  const session = await requireAuth();

  await db
    .update(events)
    .set({ isPending: 0 })
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

  revalidatePath('/calendar', 'layout');
}

export async function discardAllPendingAction() {
  const session = await requireAuth();

  await db.delete(events).where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

  revalidatePath('/calendar', 'layout');
}

export async function overridePendingDateAction(formData: FormData) {
  const session = await requireAuth();
  const newDate = formData.get('newDate') as string;
  if (!newDate) throw new Error('New date is required');

  await recalculatePendingEventsDate(session.userId, newDate);
  revalidatePath('/calendar', 'layout');
}
