'use server';

import { db } from '@/db';
import { users, tags, events, taskBoards, taskTags, tasks, discordStages } from '@/db/schema';
import { eq, and, asc, desc, sql, ne, inArray, isNull, isNotNull } from 'drizzle-orm';
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
import { deleteRecurringSeries, updateRecurringSeries } from '@/lib/recurring';
import { stageLogForUser, recalculatePendingEventsDate, mergePendingIntoNeighbours, discardPendingForUser } from '@/lib/discord-log';
import { browserDatetimeToServerDbString, addHoursToDbString } from '@/lib/timezone';
import { todayForViewer } from '@/lib/server-timezone';
import { isTagScope, tagNestingError, tagTreeOrder, type TagScope } from '@/lib/tags';
import { redeemLinkCode, unlinkDiscordAccount } from '@/lib/discord-link';
import { markStagesApproved } from '@/lib/discord-markers';
import { replaceInTitle, retitleKeepingBrackets } from '@/lib/titleParts';
import { track } from '@/lib/usage';

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

    // Give the account a task list to land on. Accounts that predate tasks get
    // theirs lazily instead — see ensureDefaultBoard in task-actions.ts.
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

// ==========================================
// Tag Actions
// ==========================================

/** Rewrites orderIndex so each subtag sits right after its parent everywhere tags are listed. */
async function renumberTags(userId: number) {
  const all = await db.select().from(tags).where(eq(tags.userId, userId));
  const ordered = tagTreeOrder(all);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].orderIndex === i + 1) continue;
    await db.update(tags).set({ orderIndex: i + 1 }).where(eq(tags.id, ordered[i].id));
  }
}

/** Throws if giving `changes` their new parents would nest more than one level. */
async function assertTagNesting(userId: number, changes: Map<number, number | null>) {
  const all = await db.select().from(tags).where(eq(tags.userId, userId));
  const parents = new Map(all.map((t) => [t.id, t.parentId]));
  for (const [id, parentId] of changes) {
    if (!parents.has(id)) throw new Error('Tag not found');
    parents.set(id, parentId);
  }
  const names = new Map(all.map((t) => [t.id, t.name]));
  const error = tagNestingError(parents, (id) => names.get(id) ?? 'Tag');
  if (error) throw new Error(error);
}

export async function addTagAction(
  name: string,
  color: string,
  scope: TagScope = 'both',
  parentId: number | null = null
) {
  const session = await requireAuth();
  track(session.userId, 'tag.create');
  const trimmedName = name.trim();

  if (!trimmedName) throw new Error('Tag name is required');
  if (!isTagScope(scope)) throw new Error('Unknown tag scope');

  if (parentId != null) {
    const [parent] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, parentId), eq(tags.userId, session.userId)))
      .limit(1);
    if (!parent || parent.isArchived) throw new Error('Parent tag not found');
    if (parent.parentId != null) {
      throw new Error(`“${parent.name}” is already a subtag, so it can’t have subtags`);
    }
  }

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
    scope,
    parentId,
    userId: session.userId,
  });
  // Last overall, so this moves it to the end of its parent's subtags.
  if (parentId != null) await renumberTags(session.userId);

  revalidatePath('/settings');
}

export async function updateTagAction(
  id: number,
  name: string,
  color: string,
  scope?: TagScope,
  parentId?: number | null
) {
  const session = await requireAuth();
  track(session.userId, 'tag.edit');
  const trimmedName = name.trim();

  if (!trimmedName) throw new Error('Tag name is required');
  // Omitted rather than defaulted: a caller that doesn't know about scope
  // shouldn't silently widen one back to 'both'.
  if (scope !== undefined && !isTagScope(scope)) throw new Error('Unknown tag scope');

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

  const reparent = parentId !== undefined && parentId !== tag.parentId;
  if (reparent) await assertTagNesting(session.userId, new Map([[id, parentId]]));

  // Update tag
  await db
    .update(tags)
    .set({
      name: trimmedName,
      color,
      ...(scope !== undefined && { scope }),
      ...(reparent && { parentId }),
    })
    .where(eq(tags.id, id));
  if (reparent) await renumberTags(session.userId);

  // If name changed, update events using the old name
  if (tag.name !== trimmedName) {
    await db
      .update(events)
      .set({ tag: trimmedName })
      .where(and(eq(events.tag, tag.name), eq(events.userId, session.userId)));
  }

  revalidatePath('/settings');
  revalidatePath('/calendar', 'layout');
  // Narrowing the scope changes which pickers offer the tag, tasks' included.
  revalidatePath('/tasks', 'layout');
  revalidatePath('/stats', 'layout');
}

export interface TagSnapshot {
  tag: typeof tags.$inferSelect;
  eventIds: number[];
  taskIds: number[];
  childIds: number[];
}

/** Returns what the tag was attached to, so Undo can put it back. */
export async function deleteTagAction(id: number): Promise<TagSnapshot> {
  const session = await requireAuth();
  track(session.userId, 'tag.delete');

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)))
    .limit(1);

  if (!tag) throw new Error('Tag not found');

  const tagged = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.tag, tag.name), eq(events.userId, session.userId)));
  const links = await db
    .select({ taskId: taskTags.taskId })
    .from(taskTags)
    .where(eq(taskTags.tagId, id));
  const children = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.parentId, id), eq(tags.userId, session.userId)));

  // Subtags outlive their parent as top-level tags.
  await db
    .update(tags)
    .set({ parentId: null })
    .where(and(eq(tags.parentId, id), eq(tags.userId, session.userId)));

  // Set events using this tag to null
  await db
    .update(events)
    .set({ tag: null })
    .where(and(eq(events.tag, tag.name), eq(events.userId, session.userId)));

  // Task links reference the tag row, so they have to go first.
  await db.delete(taskTags).where(eq(taskTags.tagId, id));

  // Delete tag
  await db.delete(tags).where(eq(tags.id, id));

  revalidatePath('/settings');
  revalidatePath('/calendar', 'layout');
  revalidatePath('/tasks', 'layout');
  return {
    tag,
    eventIds: tagged.map((e) => e.id),
    taskIds: links.map((l) => l.taskId),
    childIds: children.map((c) => c.id),
  };
}

const RESTORE_CHUNK = 500;

/**
 * Recreates a deleted tag under its old id and reattaches it. Events retagged
 * since the delete keep their new tag.
 */
export async function restoreTagAction(snapshot: TagSnapshot): Promise<{ error?: string }> {
  const session = await requireAuth();
  track(session.userId, 'undo.tag');
  const { tag } = snapshot;

  const [clash] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, session.userId), eq(tags.name, tag.name)));
  if (clash) return { error: `A tag called “${tag.name}” exists again` };

  // The old parent may have been deleted or nested since.
  let { parentId } = tag;
  if (parentId != null) {
    const [parent] = await db
      .select({ parentId: tags.parentId })
      .from(tags)
      .where(and(eq(tags.id, parentId), eq(tags.userId, session.userId)));
    if (!parent || parent.parentId != null) parentId = null;
  }

  await db
    .insert(tags)
    .values({ ...tag, parentId, userId: session.userId })
    .onConflictDoNothing();

  // Reclaim subtags that are still top-level and haven't gained subtags of their own.
  const childIds = snapshot.childIds ?? [];
  if (childIds.length) {
    const parentsNow = await db
      .select({ parentId: tags.parentId })
      .from(tags)
      .where(and(eq(tags.userId, session.userId), isNotNull(tags.parentId)));
    const hasChildren = new Set(parentsNow.map((t) => t.parentId));
    const reclaim = childIds.filter((id) => !hasChildren.has(id));
    if (reclaim.length) {
      await db
        .update(tags)
        .set({ parentId: tag.id })
        .where(
          and(eq(tags.userId, session.userId), isNull(tags.parentId), inArray(tags.id, reclaim)),
        );
    }
  }
  await renumberTags(session.userId);

  for (let i = 0; i < snapshot.eventIds.length; i += RESTORE_CHUNK) {
    await db
      .update(events)
      .set({ tag: tag.name })
      .where(
        and(
          eq(events.userId, session.userId),
          isNull(events.tag),
          inArray(events.id, snapshot.eventIds.slice(i, i + RESTORE_CHUNK)),
        ),
      );
  }

  // Only tasks that still exist and are still this user's.
  const live = snapshot.taskIds.length
    ? await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, session.userId), inArray(tasks.id, snapshot.taskIds)))
    : [];
  if (live.length) {
    await db
      .insert(taskTags)
      .values(live.map((t) => ({ taskId: t.id, tagId: tag.id })))
      .onConflictDoNothing();
  }

  revalidatePath('/settings');
  revalidatePath('/calendar', 'layout');
  revalidatePath('/tasks', 'layout');
  return {};
}

export async function archiveTagAction(id: number) {
  const session = await requireAuth();
  track(session.userId, 'tag.archive');

  await db
    .update(tags)
    .set({ isArchived: 1 })
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)));

  revalidatePath('/settings');
}

export async function unarchiveTagAction(id: number) {
  const session = await requireAuth();
  track(session.userId, 'tag.archive');

  await db
    .update(tags)
    .set({ isArchived: 0 })
    .where(and(eq(tags.id, id), eq(tags.userId, session.userId)));

  revalidatePath('/settings');
}

/**
 * Saves the settings list after a drag: every active tag in display order,
 * each with its parent. Returns rather than throws so the message survives a
 * production build.
 */
export async function arrangeTagsAction(
  layout: { id: number; parentId: number | null }[],
): Promise<{ error?: string }> {
  const session = await requireAuth();
  track(session.userId, 'tag.reorder');

  try {
    await assertTagNesting(session.userId, new Map(layout.map((t) => [t.id, t.parentId])));
  } catch (e) {
    return { error: (e as Error).message };
  }

  for (let index = 0; index < layout.length; index++) {
    await db
      .update(tags)
      .set({ orderIndex: index + 1, parentId: layout[index].parentId })
      .where(and(eq(tags.id, layout[index].id), eq(tags.userId, session.userId)));
  }
  await renumberTags(session.userId);

  revalidatePath('/settings');
  revalidatePath('/stats', 'layout');
  return {};
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
  timeZone: string;
}) {
  const session = await requireAuth();
  track(session.userId, 'event.create');

  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  // Convert HTML local date+time inputs (entered in the browser's timezone) to
  // DB format (YYYY-MM-DD HH:MM:SS) in the server's timezone (Pacific).
  const startStr = browserDatetimeToServerDbString(data.startDatetime, data.timeZone);
  let endStr = browserDatetimeToServerDbString(data.endDatetime, data.timeZone);

  if (endStr <= startStr) {
    endStr = addHoursToDbString(startStr, 1); // default 1 hour
  }

  await db.insert(events).values({
    startDatetime: startStr,
    endDatetime: endStr,
    title,
    description,
    tag,
    userId: session.userId,
    isPending: 0,
  });

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
    timeZone: string;
  }
) {
  const session = await requireAuth();
  track(session.userId, 'event.edit');

  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  const startStr = browserDatetimeToServerDbString(data.startDatetime, data.timeZone);
  let endStr = browserDatetimeToServerDbString(data.endDatetime, data.timeZone);

  if (endStr <= startStr) {
    endStr = addHoursToDbString(startStr, 1);
  }

  await db
    .update(events)
    .set({
      title,
      description,
      tag,
      startDatetime: startStr,
      endDatetime: endStr,
    })
    .where(and(eq(events.id, id), eq(events.userId, session.userId)));

  revalidatePath('/calendar', 'layout');
}

export type EventRow = typeof events.$inferSelect;

/** Returns the deleted row, so Undo can put it back. */
export async function deleteEventAction(id: number): Promise<EventRow[]> {
  const session = await requireAuth();
  track(session.userId, 'event.delete');

  const deleted = await db
    .delete(events)
    .where(and(eq(events.id, id), eq(events.userId, session.userId)))
    .returning();

  revalidatePath('/calendar', 'layout');
  return deleted;
}

/** Puts back events removed by a delete, under their original ids. */
export async function reinsertEventsAction(rows: EventRow[]) {
  const session = await requireAuth();
  track(session.userId, 'undo.event');
  if (rows.length === 0) return;

  await db
    .insert(events)
    .values(rows.map((r) => ({ ...r, userId: session.userId })))
    .onConflictDoNothing();

  revalidatePath('/calendar', 'layout');
}

export async function copyEventAction(id: number) {
  const session = await requireAuth();
  track(session.userId, 'event.copy');

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

/** Returns the deleted rows, so Undo can put them back. */
export async function deleteRecurringSeriesAction(recurrenceId: string): Promise<EventRow[]> {
  const session = await requireAuth();
  track(session.userId, 'event.series_delete');
  const deleted = await deleteRecurringSeries(recurrenceId, session.userId);
  revalidatePath('/calendar', 'layout');
  return deleted;
}

export async function updateRecurringSeriesAction(
  recurrenceId: string,
  data: { title: string; description: string; tag: string }
) {
  const session = await requireAuth();
  track(session.userId, 'event.series_edit');
  await updateRecurringSeries(recurrenceId, session.userId, data.title, data.description, data.tag);
  revalidatePath('/calendar', 'layout');
}

export interface BulkEditInput {
  renameIds: number[];
  // Null replaces each whole title; otherwise only this text inside it.
  renameFrom: string | null;
  // Same-name events. Their whole title (bar any [context]) is replaced when
  // `renameFrom` isn't found in it, since parsing can strip text
  // ("SLEEP!! :D yippee").
  exactIds: number[];
  renameMode: 'word' | 'substring';
  renameTo: string | null;
  retagIds: number[];
  // Undefined keeps each event's tag; null clears it.
  tag?: string | null;
}

const BULK_CHUNK = 500;

export interface EventSnapshot {
  id: number;
  title: string;
  tag: string | null;
}

/**
 * Renames and/or retags many events at once, from the lifetime view. Returns
 * the previous title and tag of every event it changed, for Undo.
 */
export async function bulkEditEventsAction(input: BulkEditInput) {
  const session = await requireAuth();
  track(session.userId, 'lifetime.bulk_edit');
  const renameTo = input.renameTo?.trim() || null;
  const retag = input.tag !== undefined;
  let renamed = 0;
  let retagged = 0;
  const previous: EventSnapshot[] = [];

  if (input.tag) {
    const [owned] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, session.userId), eq(tags.name, input.tag)));
    if (!owned) return { error: 'That tag no longer exists.' };
  }

  const renameSet = new Set(renameTo ? input.renameIds : []);
  const exactSet = new Set(input.exactIds);
  const retagSet = new Set(retag ? input.retagIds : []);
  const ids = [...new Set([...renameSet, ...retagSet])];

  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const rows = tx
        .select({ id: events.id, title: events.title, tag: events.tag })
        .from(events)
        .where(
          and(
            eq(events.userId, session.userId),
            eq(events.isPending, 0),
            inArray(events.id, ids.slice(i, i + BULK_CHUNK)),
          ),
        )
        .all();
      for (const row of rows) {
        let title = row.title;
        if (renameTo && renameSet.has(row.id)) {
          title = input.renameFrom
            ? replaceInTitle(row.title, input.renameFrom, renameTo, input.renameMode)
            : renameTo;
          if (title === row.title && exactSet.has(row.id)) title = retitleKeepingBrackets(row.title, renameTo);
        }
        const tag = retag && retagSet.has(row.id) ? (input.tag ?? null) : row.tag;
        if (title === row.title && tag === row.tag) continue;
        tx.update(events).set({ title, tag }).where(eq(events.id, row.id)).run();
        if (title !== row.title) renamed++;
        if (tag !== row.tag) retagged++;
        previous.push(row);
      }
    }
  });

  revalidatePath('/calendar', 'layout');
  revalidatePath('/stats', 'layout');
  return { renamed, retagged, previous };
}

/** Puts back titles and tags captured by bulkEditEventsAction. */
export async function restoreEventsAction(snapshots: EventSnapshot[]) {
  const session = await requireAuth();
  db.transaction((tx) => {
    for (const s of snapshots) {
      tx.update(events)
        .set({ title: s.title, tag: s.tag })
        .where(and(eq(events.id, s.id), eq(events.userId, session.userId)))
        .run();
    }
  });
  revalidatePath('/calendar', 'layout');
  revalidatePath('/stats', 'layout');
}

// ==========================================
// Discord Log Actions
// ==========================================

export async function stageLogAction(text: string, dateOverride?: string | null, browserTimeZone?: string) {
  const session = await requireAuth();
  track(session.userId, 'import.paste_log');
  const result = await stageLogForUser(session.userId, text, dateOverride, browserTimeZone);
  if (result.success) revalidatePath('/calendar', 'layout');
  return result;
}

/** Staged events plus the user's tags, for the import review panel. */
export async function listPendingEventsAction() {
  const session = await requireAuth();
  const [pending, userTags] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        startDatetime: events.startDatetime,
        endDatetime: events.endDatetime,
        tag: events.tag,
      })
      .from(events)
      .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)))
      .orderBy(asc(events.startDatetime)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color, isArchived: tags.isArchived, scope: tags.scope })
      .from(tags)
      .where(eq(tags.userId, session.userId))
      .orderBy(asc(tags.orderIndex)),
  ]);
  return { events: pending, tags: userTags };
}

/** Sets the tag on staged events. Returns their previous values, for Undo. */
export async function retagPendingEventsAction(ids: number[], tag: string | null) {
  const session = await requireAuth();
  if (tag) {
    const [owned] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, session.userId), eq(tags.name, tag)));
    if (!owned) return { error: 'That tag no longer exists.' };
  }

  const previous: EventSnapshot[] = [];
  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const where = and(
        eq(events.userId, session.userId),
        eq(events.isPending, 1),
        inArray(events.id, ids.slice(i, i + BULK_CHUNK)),
      );
      previous.push(
        ...tx.select({ id: events.id, title: events.title, tag: events.tag }).from(events).where(where).all(),
      );
      tx.update(events).set({ tag }).where(where).run();
    }
  });

  revalidatePath('/calendar', 'layout');
  return { previous };
}

export interface ApprovedImport {
  ids: number[];
  absorbed: EventRow[];
  extended: { id: number; endDatetime: string }[];
  stageIds: number[];
}

/** Returns what approving changed, so Undo can put the import back in pending. */
export async function approveAllPendingAction(): Promise<ApprovedImport> {
  const session = await requireAuth();
  track(session.userId, 'import.approve');

  const pending = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));
  const stages = await db
    .select({ id: discordStages.id })
    .from(discordStages)
    .where(and(eq(discordStages.userId, session.userId), isNull(discordStages.approvedAt)));

  const merged = await mergePendingIntoNeighbours(session.userId);

  await db
    .update(events)
    .set({ isPending: 0 })
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

  // Releases the `---` for the bot to post in whichever channel staged this.
  await markStagesApproved(session.userId);

  revalidatePath('/calendar', 'layout');
  const absorbed = new Set(merged.absorbed);
  return {
    ids: pending.filter((r) => !absorbed.has(r.id)).map((r) => r.id),
    absorbed: pending.filter((r) => absorbed.has(r.id)),
    extended: merged.extended,
    stageIds: stages.map((s) => s.id),
  };
}

/**
 * Reverses approveAllPendingAction. A marker the bot has already posted is
 * gone, so only the events come back for those.
 */
export async function unapproveImportAction(snapshot: ApprovedImport) {
  const session = await requireAuth();
  const mine = (ids: number[]) => and(eq(events.userId, session.userId), inArray(events.id, ids));

  db.transaction((tx) => {
    for (const { id, endDatetime } of snapshot.extended) {
      tx.update(events).set({ endDatetime }).where(mine([id])).run();
    }
    if (snapshot.absorbed.length) {
      tx.insert(events)
        .values(snapshot.absorbed.map((r) => ({ ...r, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
    const ids = [...snapshot.ids, ...snapshot.absorbed.map((r) => r.id)];
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      tx.update(events).set({ isPending: 1 }).where(mine(ids.slice(i, i + BULK_CHUNK))).run();
    }
    if (snapshot.stageIds.length) {
      tx.update(discordStages)
        .set({ approvedAt: null })
        .where(and(eq(discordStages.userId, session.userId), inArray(discordStages.id, snapshot.stageIds)))
        .run();
    }
  });

  revalidatePath('/calendar', 'layout');
}

export interface DiscardedImport {
  rows: EventRow[];
  stages: (typeof discordStages.$inferSelect)[];
}

/** Returns the discarded rows and markers, so Undo can put them back. */
export async function discardAllPendingAction(): Promise<DiscardedImport> {
  const session = await requireAuth();
  track(session.userId, 'import.discard');

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));
  const stages = await db
    .select()
    .from(discordStages)
    .where(and(eq(discordStages.userId, session.userId), isNull(discordStages.approvedAt)));

  await discardPendingForUser(session.userId);

  revalidatePath('/calendar', 'layout');
  return { rows, stages };
}

export async function restoreDiscardedImportAction({ rows, stages }: DiscardedImport) {
  const session = await requireAuth();
  db.transaction((tx) => {
    if (rows.length) {
      tx.insert(events)
        .values(rows.map((r) => ({ ...r, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
    if (stages.length) {
      tx.insert(discordStages)
        .values(stages.map((s) => ({ ...s, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
  });
  revalidatePath('/calendar', 'layout');
}

export async function overridePendingDateAction(formData: FormData) {
  const session = await requireAuth();
  track(session.userId, 'import.override_date');
  const newDate = formData.get('newDate') as string;
  if (!newDate) throw new Error('New date is required');

  await recalculatePendingEventsDate(session.userId, newDate);
  revalidatePath('/calendar', 'layout');
}

// ==========================================
// Discord Link Actions
// ==========================================

export async function linkDiscordAction(code: string, timeZone: string | null) {
  const session = await requireAuth();
  track(session.userId, 'discord.link');
  const result = await redeemLinkCode(code, session.userId, timeZone);
  if ('error' in result) return { error: result.error };

  revalidatePath('/settings');
  return { success: true, discordUsername: result.discordUsername };
}

export async function unlinkDiscordAction(discordUserId: string) {
  const session = await requireAuth();
  track(session.userId, 'discord.unlink');
  await unlinkDiscordAccount(session.userId, discordUserId);
  revalidatePath('/settings');
}
