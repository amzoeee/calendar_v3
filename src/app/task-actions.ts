'use server';

import { db } from '@/db';
import { taskBoards, tasks, taskCompletions } from '@/db/schema';
import { eq, and, sql, isNull, isNotNull, inArray } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { dateToServerDbString } from '@/lib/timezone';
import { MAX_TASK_DEPTH, type SortMode } from '@/lib/tasks';

const VALID_SORT_MODES: SortMode[] = ['manual', 'alpha', 'created', 'remind', 'deadline'];

function refresh() {
  revalidatePath('/tasks', 'layout');
}

// "Now" as a Pacific wall-clock string, the same convention events use.
function now(): string {
  return dateToServerDbString(new Date());
}

// ==========================================
// Boards
// ==========================================

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
    .orderBy(taskBoards.orderIndex)
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(taskBoards)
    .values({ name: 'My Tasks', orderIndex: 1, userId })
    .returning({ id: taskBoards.id });

  return created.id;
}

export async function createBoardAction(name: string): Promise<number> {
  const session = await requireAuth();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Board name is required');

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${taskBoards.orderIndex}), 0)` })
    .from(taskBoards)
    .where(eq(taskBoards.userId, session.userId));

  const [created] = await db
    .insert(taskBoards)
    .values({ name: trimmed, orderIndex: maxOrder + 1, userId: session.userId })
    .returning({ id: taskBoards.id });

  refresh();
  return created.id;
}

export async function renameBoardAction(id: number, name: string): Promise<void> {
  const session = await requireAuth();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Board name is required');

  await db
    .update(taskBoards)
    .set({ name: trimmed })
    .where(and(eq(taskBoards.id, id), eq(taskBoards.userId, session.userId)));

  refresh();
}

export async function setBoardSortAction(id: number, sortMode: string): Promise<void> {
  const session = await requireAuth();
  if (!VALID_SORT_MODES.includes(sortMode as SortMode)) {
    throw new Error(`Unknown sort mode '${sortMode}'`);
  }

  await db
    .update(taskBoards)
    .set({ sortMode })
    .where(and(eq(taskBoards.id, id), eq(taskBoards.userId, session.userId)));

  refresh();
}

/**
 * Delete a board. Its tasks either move to another board or are deleted with
 * it — the caller decides, since silently destroying tasks would be worse than
 * either option.
 */
export async function deleteBoardAction(
  id: number,
  moveTasksToBoardId: number | null
): Promise<void> {
  const session = await requireAuth();

  const boards = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(eq(taskBoards.userId, session.userId));

  if (boards.length <= 1) throw new Error('Your last board cannot be deleted');
  if (!boards.some((b) => b.id === id)) throw new Error('Board not found');

  if (moveTasksToBoardId != null) {
    if (!boards.some((b) => b.id === moveTasksToBoardId)) {
      throw new Error('Destination board not found');
    }
    await db
      .update(tasks)
      .set({ boardId: moveTasksToBoardId })
      .where(and(eq(tasks.boardId, id), eq(tasks.userId, session.userId)));
  } else {
    const doomed = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.boardId, id), eq(tasks.userId, session.userId)));
    const ids = doomed.map((t) => t.id);
    if (ids.length > 0) {
      await db.delete(taskCompletions).where(inArray(taskCompletions.taskId, ids));
      await db.delete(tasks).where(inArray(tasks.id, ids));
    }
  }

  await db
    .delete(taskBoards)
    .where(and(eq(taskBoards.id, id), eq(taskBoards.userId, session.userId)));

  refresh();
}

// ==========================================
// Tasks
// ==========================================

/**
 * Every id in the subtree rooted at `id`, the root included.
 *
 * Recursive rather than "the row plus its direct children" on purpose: it is no
 * harder to write, and it means delete / move / complete already behave
 * correctly at any depth if MAX_TASK_DEPTH is ever raised.
 */
async function subtreeIds(id: number, userId: number): Promise<number[]> {
  const rows = await db.all<{ id: number }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM tasks WHERE id = ${id} AND user_id = ${userId}
      UNION ALL
      SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
    )
    SELECT id FROM sub
  `);
  return rows.map((r) => r.id);
}

export async function createTaskAction(
  boardId: number,
  title: string,
  parentId: number | null = null
): Promise<number> {
  const session = await requireAuth();
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Task title is required');

  const [board] = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(and(eq(taskBoards.id, boardId), eq(taskBoards.userId, session.userId)))
    .limit(1);
  if (!board) throw new Error('Board not found');

  let depth = 0;
  if (parentId != null) {
    const [parent] = await db
      .select({ depth: tasks.depth, boardId: tasks.boardId })
      .from(tasks)
      .where(and(eq(tasks.id, parentId), eq(tasks.userId, session.userId)))
      .limit(1);
    if (!parent) throw new Error('Parent task not found');
    if (parent.boardId !== boardId) throw new Error('Parent task is on another board');

    depth = parent.depth + 1;
    if (depth > MAX_TASK_DEPTH) throw new Error('Subtasks cannot be nested further');
  }

  // orderIndex is scoped to (boardId, parentId) — siblings order among
  // themselves. New top-level tasks go to the top of the list; new subtasks
  // append below their existing siblings, where you'd expect a step to land.
  const siblingScope = and(
    eq(tasks.userId, session.userId),
    eq(tasks.boardId, boardId),
    parentId == null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId)
  );
  const [{ minOrder, maxOrder }] = await db
    .select({
      minOrder: sql<number>`coalesce(min(${tasks.orderIndex}), 0)`,
      maxOrder: sql<number>`coalesce(max(${tasks.orderIndex}), 0)`,
    })
    .from(tasks)
    .where(siblingScope);

  const orderIndex = parentId == null ? minOrder - 1 : maxOrder + 1;

  const [created] = await db
    .insert(tasks)
    .values({
      userId: session.userId,
      boardId,
      parentId,
      depth,
      orderIndex,
      title: trimmed,
    })
    .returning({ id: tasks.id });

  refresh();
  return created.id;
}

export async function updateTaskAction(
  id: number,
  fields: { title?: string; description?: string | null }
): Promise<void> {
  const session = await requireAuth();

  const patch: { title?: string; description?: string | null } = {};
  if (fields.title !== undefined) {
    const trimmed = fields.title.trim();
    if (!trimmed) throw new Error('Task title is required');
    patch.title = trimmed;
  }
  if (fields.description !== undefined) {
    patch.description = fields.description?.trim() || null;
  }
  if (Object.keys(patch).length === 0) return;

  await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, id), eq(tasks.userId, session.userId)));

  refresh();
}

export async function setTaskStarredAction(id: number, starred: boolean): Promise<void> {
  const session = await requireAuth();
  await db
    .update(tasks)
    .set({ isStarred: starred ? 1 : 0 })
    .where(and(eq(tasks.id, id), eq(tasks.userId, session.userId)));
  refresh();
}

/**
 * Tick or untick a task, optionally carrying its subtree with it.
 *
 * Returns the ids it actually changed — not the whole subtree — so Undo can put
 * back exactly what moved. A subtask that was already ticked before its parent
 * was completed stays ticked when the parent is un-ticked.
 */
export async function toggleTaskCompletionAction(
  id: number,
  completed: boolean,
  cascade: boolean
): Promise<number[]> {
  const session = await requireAuth();

  const candidateIds = cascade ? await subtreeIds(id, session.userId) : [id];
  if (candidateIds.length === 0) throw new Error('Task not found');

  const rows = await db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(inArray(tasks.id, candidateIds), eq(tasks.userId, session.userId)));

  const changing = rows.filter((r) => Boolean(r.completedAt) !== completed);
  if (changing.length === 0) return [];

  await applyCompletion(
    session.userId,
    changing.map((r) => ({ id: r.id, title: r.title })),
    completed
  );

  refresh();
  return changing.map((r) => r.id);
}

/**
 * Force a specific set of tasks to a completion state. This is what Undo calls,
 * with the ids the original toggle reported changing.
 */
export async function setTaskCompletionAction(
  ids: number[],
  completed: boolean
): Promise<void> {
  const session = await requireAuth();
  if (ids.length === 0) return;

  const rows = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.userId, session.userId)));
  if (rows.length === 0) return;

  await applyCompletion(session.userId, rows, completed);
  refresh();
}

/**
 * Write the completion state and keep the history table in step.
 *
 * Ticking appends to task_completions; unticking removes the most recent row
 * for that task, so an undo doesn't leave a phantom completion for the stats
 * page to count.
 */
async function applyCompletion(
  userId: number,
  rows: { id: number; title: string }[],
  completed: boolean
): Promise<void> {
  const ids = rows.map((r) => r.id);
  const stamp = completed ? now() : null;

  await db
    .update(tasks)
    .set({ completedAt: stamp })
    .where(and(inArray(tasks.id, ids), eq(tasks.userId, userId)));

  if (completed) {
    await db.insert(taskCompletions).values(
      rows.map((r) => ({
        userId,
        taskId: r.id,
        completedAt: stamp as string,
        titleSnapshot: r.title,
      }))
    );
  } else {
    for (const id of ids) {
      await db.run(sql`
        DELETE FROM task_completions
        WHERE id = (
          SELECT id FROM task_completions
          WHERE task_id = ${id} AND user_id = ${userId}
          ORDER BY completed_at DESC, id DESC
          LIMIT 1
        )
      `);
    }
  }
}

export async function deleteTaskAction(id: number): Promise<void> {
  const session = await requireAuth();

  const ids = await subtreeIds(id, session.userId);
  if (ids.length === 0) throw new Error('Task not found');

  await db.delete(taskCompletions).where(
    and(inArray(taskCompletions.taskId, ids), eq(taskCompletions.userId, session.userId))
  );
  await db.delete(tasks).where(and(inArray(tasks.id, ids), eq(tasks.userId, session.userId)));

  refresh();
}

/** Move a task and everything under it to another board. */
export async function moveTaskToBoardAction(id: number, boardId: number): Promise<void> {
  const session = await requireAuth();

  const [board] = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(and(eq(taskBoards.id, boardId), eq(taskBoards.userId, session.userId)))
    .limit(1);
  if (!board) throw new Error('Board not found');

  const ids = await subtreeIds(id, session.userId);
  if (ids.length === 0) throw new Error('Task not found');

  // The subtree keeps its internal shape; only the root rejoins the top level
  // of its new board, above whatever is already there.
  const [{ minOrder }] = await db
    .select({ minOrder: sql<number>`coalesce(min(${tasks.orderIndex}), 0)` })
    .from(tasks)
    .where(
      and(eq(tasks.userId, session.userId), eq(tasks.boardId, boardId), isNull(tasks.parentId))
    );

  await db
    .update(tasks)
    .set({ boardId })
    .where(and(inArray(tasks.id, ids), eq(tasks.userId, session.userId)));

  await db
    .update(tasks)
    .set({ parentId: null, depth: 0, orderIndex: minOrder - 1 })
    .where(and(eq(tasks.id, id), eq(tasks.userId, session.userId)));

  refresh();
}

/** Clear out a board's finished tasks. History in task_completions survives. */
export async function deleteCompletedTasksAction(boardId: number | null): Promise<number> {
  const session = await requireAuth();

  const scope = boardId == null
    ? and(eq(tasks.userId, session.userId), isNotNull(tasks.completedAt))
    : and(
        eq(tasks.userId, session.userId),
        eq(tasks.boardId, boardId),
        isNotNull(tasks.completedAt)
      );

  const done = await db.select({ id: tasks.id }).from(tasks).where(scope);
  const ids = done.map((t) => t.id);
  if (ids.length === 0) return 0;

  // Subtasks of a completed parent go too, even if they were left open.
  const all = new Set<number>();
  for (const id of ids) {
    for (const sub of await subtreeIds(id, session.userId)) all.add(sub);
  }
  const allIds = [...all];

  await db.delete(taskCompletions).where(
    and(inArray(taskCompletions.taskId, allIds), eq(taskCompletions.userId, session.userId))
  );
  await db.delete(tasks).where(and(inArray(tasks.id, allIds), eq(tasks.userId, session.userId)));

  refresh();
  return allIds.length;
}
