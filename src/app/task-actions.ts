'use server';

import { db } from '@/db';
import { taskBoards, tasks, taskCompletions, taskTags, tags } from '@/db/schema';
import { eq, and, sql, isNull, isNotNull, inArray } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { dateToServerDbString, browserDatetimeToServerDbString } from '@/lib/timezone';
import { getViewerTimeZone } from '@/lib/server-timezone';
import { computeRemindAt, END_OF_DAY, displayTitle } from '@/lib/taskSchedule';
import { expandRrule } from '@/lib/recurring';
import { dateStrInTimeZone } from '@/lib/timezone';
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


/**
 * The deadline a rolling task should move to once the current one is done.
 *
 * Two conditions, and the second is what stops a neglected task from
 * marching through history: the occurrence has to be later than the deadline
 * being retired *and* later than today. Ticking off something that was due
 * three Wednesdays ago moves it to the next Wednesday, not to two Wednesdays
 * ago.
 *
 * Reuses the calendar's RRULE expander rather than reimplementing the
 * stepping, so weekday handling and the Jan 31 -> Feb 28 month clamp come for
 * free.
 */
function nextTaskOccurrence(
  currentDue: string,
  rrule: string,
  todayStr: string
): string | null {
  for (const [start] of expandRrule(currentDue, currentDue, rrule, 400)) {
    if (start > currentDue && start.split(' ')[0] > todayStr) return start;
  }
  return null;
}

/** What a completion did to a rolling task, so Undo can put it back. */
export interface RolledForward {
  taskId: number;
  previousDue: string | null;
  previousCounter: number | null;
  /** Subtasks the roll reset, so Undo can re-complete exactly those. */
  resetIds: number[];
}

/**
 * Advance a rolling task past the deadline just completed (or skipped).
 *
 * Returns what it changed so the caller can offer a precise undo, or null if
 * the task doesn't roll — either it isn't recurring, or its counter has run
 * out and the series is over.
 */
async function rollForward(
  taskId: number,
  userId: number,
  subtree: number[]
): Promise<RolledForward | null> {
  const [task] = await db
    .select({
      dueDatetime: tasks.dueDatetime,
      rrule: tasks.rrule,
      counterValue: tasks.counterValue,
      counterEnd: tasks.counterEnd,
      remindOffsetMinutes: tasks.remindOffsetMinutes,
      remindOffsetDays: tasks.remindOffsetDays,
      remindTimeOfDay: tasks.remindTimeOfDay,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!task?.rrule || !task.dueDatetime) return null;

  // The series can be numbered and finite; when the count runs out the task
  // stops recurring and simply stays done.
  const nextCounter = task.counterValue == null ? null : task.counterValue + 1;
  if (nextCounter != null && task.counterEnd != null && nextCounter > task.counterEnd) {
    await db
      .update(tasks)
      .set({ rrule: null })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
    return null;
  }

  const todayStr = dateStrInTimeZone(await getViewerTimeZone());
  const nextDue = nextTaskOccurrence(task.dueDatetime, task.rrule, todayStr);
  if (!nextDue) return null;

  // The reminder is an offset, so it re-derives from the new deadline. That
  // is the whole reason it isn't stored as a fixed moment.
  const remindAt = computeRemindAt(
    nextDue,
    task.remindOffsetMinutes,
    task.remindOffsetDays,
    task.remindTimeOfDay
  );

  // Subtasks are the steps of this occurrence, so they come back open for the
  // next one. Their completion history stays in task_completions.
  const resetIds = subtree.filter((id) => id !== taskId);

  await db
    .update(tasks)
    .set({ completedAt: null, dueDatetime: nextDue, remindAt, counterValue: nextCounter })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));

  if (resetIds.length > 0) {
    await db
      .update(tasks)
      .set({ completedAt: null })
      .where(and(inArray(tasks.id, resetIds), eq(tasks.userId, userId)));
  }

  return {
    taskId,
    previousDue: task.dueDatetime,
    previousCounter: task.counterValue,
    resetIds,
  };
}

/** Move a rolling task on without recording it as done. */
export async function skipOccurrenceAction(taskId: number): Promise<void> {
  const session = await requireAuth();
  const subtree = await subtreeIds(taskId, session.userId);
  if (subtree.length === 0) throw new Error('Task not found');
  await rollForward(taskId, session.userId, subtree);
  refresh();
}

/**
 * Move a deadline, carrying the reminder with it.
 *
 * The reminder is stored as an offset precisely so this is possible: the
 * materialised `remindAt` is re-derived from the new deadline rather than left
 * pointing at the old one.
 */
async function applyDeadline(
  taskId: number,
  userId: number,
  dueDatetime: string
): Promise<void> {
  const [task] = await db
    .select({
      remindOffsetMinutes: tasks.remindOffsetMinutes,
      remindOffsetDays: tasks.remindOffsetDays,
      remindTimeOfDay: tasks.remindTimeOfDay,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  if (!task) throw new Error('Task not found');

  await db
    .update(tasks)
    .set({
      dueDatetime,
      remindAt: computeRemindAt(
        dueDatetime,
        task.remindOffsetMinutes,
        task.remindOffsetDays,
        task.remindTimeOfDay
      ),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
}

/**
 * Push a repeating task's deadline on by one cycle, keeping the occurrence.
 *
 * Deliberately not the same thing as skipping. Skip means "not doing this
 * one": it advances the deadline *and* the counter, and the occurrence is
 * gone. Postpone means "doing it, later" — same occurrence, same number, later
 * date. The rest of the series follows on its own, since a rolling task's next
 * deadline is computed from its current one.
 *
 * Exactly one step, so the button's label ("+1 week") is the literal truth.
 * A task three weeks overdue lands a week after the deadline it already
 * missed, not next week; pressing it again steps again. Deciding otherwise
 * here would mean the label and the result disagreed.
 */
export async function postponeOccurrenceAction(
  taskId: number
): Promise<{ previousDue: string; due: string } | null> {
  const session = await requireAuth();

  const [task] = await db
    .select({ dueDatetime: tasks.dueDatetime, rrule: tasks.rrule })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)))
    .limit(1);
  if (!task) throw new Error('Task not found');
  if (!task.rrule || !task.dueDatetime) return null;

  // One step needs the current deadline and the one after it. A couple spare,
  // because a rule can name the same instant twice.
  const currentDue = task.dueDatetime;
  const next = expandRrule(currentDue, currentDue, task.rrule, 4)
    .map(([start]) => start)
    .find((start) => start > currentDue);
  // A finite rule (COUNT, UNTIL) can have nothing left to move to.
  if (!next) return null;

  await applyDeadline(taskId, session.userId, next);
  refresh();
  return { previousDue: currentDue, due: next };
}

/** A stored wall-clock deadline, "YYYY-MM-DD HH:MM:SS". */
const DB_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Put a deadline back to a value the client was just handed, so undoing a
 * postpone doesn't have to step backwards through an RRULE — which, for
 * monthly rules with their end-of-month clamp, isn't reliably invertible.
 */
export async function restoreTaskDeadlineAction(
  taskId: number,
  dueDatetime: string
): Promise<void> {
  const session = await requireAuth();
  if (!DB_DATETIME.test(dueDatetime)) throw new Error('Invalid deadline');
  await applyDeadline(taskId, session.userId, dueDatetime);
  refresh();
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

/**
 * Create many tasks at once from a pasted list.
 *
 * Items arrive already parsed and ordered, each with a depth and an optional
 * deadline, because the caller has shown the user a preview of exactly this
 * and the two must not disagree. A depth-1 item attaches to the most recent
 * depth-0 one; an indented first line has no parent to attach to and is
 * promoted rather than rejected.
 */
export async function createTasksBulkAction(
  boardId: number,
  items: { title: string; depth: number; dueDate: string | null }[]
): Promise<number> {
  const session = await requireAuth();

  const [board] = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(and(eq(taskBoards.id, boardId), eq(taskBoards.userId, session.userId)))
    .limit(1);
  if (!board) throw new Error('List not found');

  const clean = items
    .map((i) => ({ ...i, title: i.title.trim() }))
    .filter((i) => i.title.length > 0);
  if (clean.length === 0) return 0;

  const tz = await getViewerTimeZone();

  const [{ minOrder }] = await db
    .select({ minOrder: sql<number>`coalesce(min(${tasks.orderIndex}), 0)` })
    .from(tasks)
    .where(
      and(eq(tasks.userId, session.userId), eq(tasks.boardId, boardId), isNull(tasks.parentId))
    );

  let topOrder = minOrder - clean.length;
  let lastTopId: number | null = null;
  let childOrder = 0;
  let created = 0;

  for (const item of clean) {
    const parentId: number | null = item.depth > 0 ? lastTopId : null;
    const isChild: boolean = parentId !== null;

    const dueDatetime = item.dueDate
      ? browserDatetimeToServerDbString(`${item.dueDate}T${END_OF_DAY}`, tz)
      : null;

    // Annotated because lastTopId is assigned from this result and also feeds
    // the row being inserted, which TypeScript reads as circular otherwise.
    const inserted: { id: number }[] = await db
      .insert(tasks)
      .values({
        userId: session.userId,
        boardId,
        parentId,
        depth: isChild ? 1 : 0,
        orderIndex: isChild ? childOrder++ : topOrder++,
        title: item.title,
        dueDatetime,
        dueHasTime: 0,
      })
      .returning({ id: tasks.id });

    if (!isChild) {
      lastTopId = inserted[0].id;
      childOrder = 0;
    }
    created += 1;
  }

  refresh();
  return created;
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
): Promise<{ changed: number[]; rolled: RolledForward | null }> {
  const session = await requireAuth();

  const candidateIds = cascade ? await subtreeIds(id, session.userId) : [id];
  if (candidateIds.length === 0) throw new Error('Task not found');

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      counterValue: tasks.counterValue,
      completedAt: tasks.completedAt,
      dueDatetime: tasks.dueDatetime,
    })
    .from(tasks)
    .where(and(inArray(tasks.id, candidateIds), eq(tasks.userId, session.userId)));

  const changing = rows.filter((r) => Boolean(r.completedAt) !== completed);
  if (changing.length === 0) return { changed: [], rolled: null };

  await applyCompletion(
    session.userId,
    // The snapshot records what was finished, so a numbered task has to have
    // its counter resolved — "Problem Set {n}" is the template, not the thing
    // that got done.
    changing.map((r) => ({
      id: r.id,
      title: displayTitle(r.title, r.counterValue),
      dueDatetime: r.dueDatetime,
    })),
    completed
  );

  // A recurring task doesn't stay done — the completion is recorded, then the
  // task moves to its next deadline. This is why task_completions exists: the
  // row's own completedAt is about to be cleared again.
  const rolled = completed
    ? await rollForward(id, session.userId, candidateIds)
    : null;

  refresh();
  return { changed: changing.map((r) => r.id), rolled };
}

/**
 * Force a specific set of tasks to a completion state. This is what Undo calls,
 * with the ids the original toggle reported changing.
 */
export async function setTaskCompletionAction(
  ids: number[],
  completed: boolean,
  rolled: RolledForward | null = null
): Promise<void> {
  const session = await requireAuth();

  // Undoing a completion that rolled the task forward has to put the deadline
  // and the counter back too, or "undo" would quietly leave it a week ahead.
  if (rolled) {
    const [task] = await db
      .select({
        remindOffsetMinutes: tasks.remindOffsetMinutes,
        remindOffsetDays: tasks.remindOffsetDays,
        remindTimeOfDay: tasks.remindTimeOfDay,
      })
      .from(tasks)
      .where(and(eq(tasks.id, rolled.taskId), eq(tasks.userId, session.userId)))
      .limit(1);

    await db
      .update(tasks)
      .set({
        dueDatetime: rolled.previousDue,
        counterValue: rolled.previousCounter,
        remindAt: task
          ? computeRemindAt(
              rolled.previousDue,
              task.remindOffsetMinutes,
              task.remindOffsetDays,
              task.remindTimeOfDay
            )
          : null,
      })
      .where(and(eq(tasks.id, rolled.taskId), eq(tasks.userId, session.userId)));
  }

  if (ids.length === 0) return;

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      counterValue: tasks.counterValue,
      dueDatetime: tasks.dueDatetime,
    })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.userId, session.userId)));
  if (rows.length === 0) return;

  await applyCompletion(
    session.userId,
    rows.map((r) => ({
      id: r.id,
      title: displayTitle(r.title, r.counterValue),
      dueDatetime: r.dueDatetime,
    })),
    completed
  );
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
  rows: { id: number; title: string; dueDatetime: string | null }[],
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
        dueSnapshot: r.dueDatetime,
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


/**
 * The subtree rooted at `id` with each row's depth and parent, root included.
 * Used by moveTaskAction, which has to re-depth descendants and reject a move
 * that would push any of them past MAX_TASK_DEPTH.
 */
async function subtreeRows(
  id: number,
  userId: number
): Promise<{ id: number; parentId: number | null; depth: number }[]> {
  return db.all<{ id: number; parentId: number | null; depth: number }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM tasks WHERE id = ${id} AND user_id = ${userId}
      UNION ALL
      SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
    )
    SELECT t.id AS id, t.parent_id AS parentId, t.depth AS depth
    FROM tasks t JOIN sub ON t.id = sub.id
  `);
}

/**
 * Move a task — reparent it, move it between lists, reorder it among its
 * siblings, or all three at once. This is what a drag commits, and what the
 * keyboard reorder shortcuts call.
 *
 * `siblingIds` is the caller's desired order for the destination parent's
 * children, moved task included. Sending the whole order rather than an index
 * keeps the server from having to guess where a fractional position lands, and
 * makes the write idempotent if the same drag is committed twice.
 */
export async function moveTaskAction(
  id: number,
  target: { boardId: number; parentId: number | null; siblingIds: number[] }
): Promise<void> {
  const session = await requireAuth();
  const { boardId, parentId, siblingIds } = target;

  const [board] = await db
    .select({ id: taskBoards.id })
    .from(taskBoards)
    .where(and(eq(taskBoards.id, boardId), eq(taskBoards.userId, session.userId)))
    .limit(1);
  if (!board) throw new Error('List not found');

  const subtree = await subtreeRows(id, session.userId);
  if (subtree.length === 0) throw new Error('Task not found');

  const moved = subtree.find((r) => r.id === id)!;
  const subtreeIds = new Set(subtree.map((r) => r.id));

  let newDepth = 0;
  if (parentId != null) {
    // Dropping a task inside its own subtree would orphan the whole branch.
    if (subtreeIds.has(parentId)) throw new Error('A task cannot be nested inside itself');

    const [parent] = await db
      .select({ depth: tasks.depth, boardId: tasks.boardId })
      .from(tasks)
      .where(and(eq(tasks.id, parentId), eq(tasks.userId, session.userId)))
      .limit(1);
    if (!parent) throw new Error('Parent task not found');
    if (parent.boardId !== boardId) throw new Error('Parent task is on another list');
    newDepth = parent.depth + 1;
  }

  // The deepest descendant has to fit too, not just the task being dragged.
  const height = Math.max(...subtree.map((r) => r.depth)) - moved.depth;
  if (newDepth + height > MAX_TASK_DEPTH) {
    throw new Error('That would nest subtasks deeper than allowed');
  }

  const shift = newDepth - moved.depth;
  for (const row of subtree) {
    const patch: { boardId: number; depth: number; parentId?: number | null } = {
      boardId,
      depth: row.depth + shift,
    };
    if (row.id === id) patch.parentId = parentId;
    await db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, row.id), eq(tasks.userId, session.userId)));
  }

  // Rewrite the destination's sibling order. Ids that aren't the user's, or
  // that no longer sit under this parent, are dropped rather than trusted.
  const validSiblings = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, session.userId),
        eq(tasks.boardId, boardId),
        parentId == null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId)
      )
    );
  const allowed = new Set(validSiblings.map((r) => r.id));

  let index = 0;
  for (const siblingId of siblingIds) {
    if (!allowed.has(siblingId)) continue;
    await db
      .update(tasks)
      .set({ orderIndex: index })
      .where(and(eq(tasks.id, siblingId), eq(tasks.userId, session.userId)));
    index += 1;
  }

  refresh();
}

/**
 * Replace a task's tags.
 *
 * The join table keys on tag id, so this is a plain delete-and-reinsert — no
 * cascading of names the way events.tag needs. Tag ids that aren't the
 * caller's are dropped rather than trusted.
 */
export async function setTaskTagsAction(taskId: number, tagIds: number[]): Promise<void> {
  const session = await requireAuth();

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)))
    .limit(1);
  if (!task) throw new Error('Task not found');

  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));

  if (tagIds.length === 0) {
    refresh();
    return;
  }

  const owned = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, tagIds), eq(tags.userId, session.userId)));
  const allowed = new Set(owned.map((t) => t.id));

  const rows = [...new Set(tagIds)]
    .filter((id) => allowed.has(id))
    .map((tagId) => ({ taskId, tagId }));
  if (rows.length > 0) await db.insert(taskTags).values(rows);

  refresh();
}

/**
 * Set (or clear) a task's deadline and reminder.
 *
 * Everything arrives as wall-clock values in the viewer's timezone, the way
 * they were typed, and is converted to the app's Pacific strings here — the
 * same round trip event times make.
 *
 * `remindAt` is materialised rather than derived on read. It keeps the
 * eventual reminder scheduler to a plain indexed comparison instead of
 * per-row arithmetic, and it lets the UI show the literal outcome ("Reminds
 * Tue, Sep 2 at 6:00 PM") rather than an offset the reader has to apply.
 */
export async function setTaskScheduleAction(
  taskId: number,
  input: {
    /** "YYYY-MM-DD" as the viewer typed it, or null to clear the deadline. */
    dueDate: string | null;
    /** "HH:MM", or null for a deadline that names only a day. */
    dueTime: string | null;
    remindOffsetMinutes: number | null;
    remindOffsetDays: number | null;
    /** "HH:MM", paired with remindOffsetDays. */
    remindTimeOfDay: string | null;
  }
): Promise<void> {
  const session = await requireAuth();

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)))
    .limit(1);
  if (!task) throw new Error('Task not found');

  if (!input.dueDate) {
    // No deadline means no reminder — an offset from nothing has no meaning.
    await db
      .update(tasks)
      .set({
        dueDatetime: null,
        dueHasTime: 0,
        remindAt: null,
        remindOffsetMinutes: null,
        remindOffsetDays: null,
        remindTimeOfDay: null,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)));
    refresh();
    return;
  }

  const tz = await getViewerTimeZone();
  const hasTime = Boolean(input.dueTime);

  // A day-only deadline is stored at the end of that day, so it still sorts
  // and compares against timed ones without special-casing.
  const dueDatetime = browserDatetimeToServerDbString(
    `${input.dueDate}T${input.dueTime ?? END_OF_DAY}`,
    tz
  );

  // The reminder's time of day was typed in the viewer's timezone too. It
  // needs a date to resolve against, and the deadline's own date is the one
  // that matters here.
  let remindTimeOfDay: string | null = null;
  if (input.remindTimeOfDay) {
    const asPacific = browserDatetimeToServerDbString(
      `${input.dueDate}T${input.remindTimeOfDay}`,
      tz
    );
    remindTimeOfDay = asPacific.split(' ')[1].slice(0, 5);
  }

  const remindAt = computeRemindAt(
    dueDatetime,
    input.remindOffsetMinutes,
    input.remindOffsetDays,
    remindTimeOfDay
  );

  await db
    .update(tasks)
    .set({
      dueDatetime,
      dueHasTime: hasTime ? 1 : 0,
      remindAt,
      remindOffsetMinutes: input.remindOffsetMinutes,
      remindOffsetDays: input.remindOffsetDays,
      remindTimeOfDay,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)));

  refresh();
}

/**
 * Set (or clear) a task's repeat rule and its optional numbering.
 *
 * Recurrence is rolling: one row that advances, not a run of rows generated up
 * front. That means editing it is unambiguous — there is no "this occurrence
 * or the whole series?" question, because there is only ever one row.
 *
 * A repeat needs a deadline to advance from, so setting one without a deadline
 * is refused rather than silently stored and ignored.
 */
export async function setTaskRecurrenceAction(
  taskId: number,
  rrule: string | null,
  counterStart: number | null,
  counterEnd: number | null
): Promise<void> {
  const session = await requireAuth();

  const [task] = await db
    .select({ dueDatetime: tasks.dueDatetime, counterValue: tasks.counterValue })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)))
    .limit(1);
  if (!task) throw new Error('Task not found');
  if (rrule && !task.dueDatetime) throw new Error('Give the task a deadline before it can repeat');

  await db
    .update(tasks)
    .set({
      rrule,
      // Clearing the repeat clears the numbering with it; a counter that no
      // longer counts anything would just be a stray number in the title.
      counterValue: rrule ? (counterStart ?? task.counterValue ?? null) : null,
      counterEnd: rrule ? counterEnd : null,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.userId)));

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
