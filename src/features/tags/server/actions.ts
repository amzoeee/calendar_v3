'use server';

import { db } from '@/db';
import { tags, events, taskTags, tasks } from '@/db/schema';
import { eq, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { isTagScope, tagNestingError, tagTreeOrder, type TagScope } from '@/lib/tags';
import { track } from '@/lib/usage';

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
