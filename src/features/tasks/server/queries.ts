import { db } from '@/db';
import { taskBoards, tasks as tasksTable, taskTags, tags as tagsTable } from '@/db/schema';
import { eq, and, asc, desc, inArray, or, gte, lt, isNull, sql } from 'drizzle-orm';
import { dateStrInTimeZone, shiftDateStr } from '@/lib/timezone';
import { getViewerTimeZone } from '@/lib/server-timezone';
import { bucketCalendarTasks, type CalendarTasksByDay } from '@/lib/calendarTasks';

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

export async function getBoards(userId: number) {
  return db
    .select()
    .from(taskBoards)
    .where(eq(taskBoards.userId, userId))
    .orderBy(asc(taskBoards.orderIndex), asc(taskBoards.id));
}

// A flat list across every visible board, ordered by sibling position. The
// client assembles the tree — see buildTaskTree in lib/tasks.ts for why the
// nesting isn't done here.
export async function getTaskRows(userId: number, boardIds: number[]) {
  return db
    .select({
      id: tasksTable.id,
      boardId: tasksTable.boardId,
      parentId: tasksTable.parentId,
      depth: tasksTable.depth,
      orderIndex: tasksTable.orderIndex,
      title: tasksTable.title,
      description: tasksTable.description,
      dueDatetime: tasksTable.dueDatetime,
      dueHasTime: tasksTable.dueHasTime,
      dueAsap: tasksTable.dueAsap,
      remindAt: tasksTable.remindAt,
      remindOffsetMinutes: tasksTable.remindOffsetMinutes,
      remindOffsetDays: tasksTable.remindOffsetDays,
      remindTimeOfDay: tasksTable.remindTimeOfDay,
      isStarred: tasksTable.isStarred,
      completedAt: tasksTable.completedAt,
      rrule: tasksTable.rrule,
      counterValue: tasksTable.counterValue,
      counterEnd: tasksTable.counterEnd,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, userId),
        inArray(tasksTable.boardId, boardIds)
      )
    )
    .orderBy(asc(tasksTable.orderIndex), asc(tasksTable.id));
}

export async function getTaskTagOptions(userId: number) {
  return db
    .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color })
    .from(tagsTable)
    .where(
      and(
        eq(tagsTable.userId, userId),
        eq(tagsTable.isArchived, 0),
        inArray(tagsTable.scope, ['task', 'both'])
      )
    )
    .orderBy(asc(tagsTable.orderIndex), asc(tagsTable.id));
}

export async function getTagsByTask(taskIds: number[]): Promise<Record<number, number[]>> {
  const tagLinks = taskIds.length
    ? await db
        .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
        .from(taskTags)
        .where(inArray(taskTags.taskId, taskIds))
    : [];

  const tagsByTask: Record<number, number[]> = {};
  for (const link of tagLinks) {
    (tagsByTask[link.taskId] ??= []).push(link.tagId);
  }

  return tagsByTask;
}

/**
 * Tasks for the calendar's day banners over the viewer's days [from, to]:
 * dated ones in that span and open ASAP ones (on today).
 */
export async function getCalendarTasks(userId: number, from: string, to: string): Promise<CalendarTasksByDay> {
  // Deadlines are Pacific strings; a day of padding covers any viewer offset.
  const lo = `${shiftDateStr(from, -1)} 00:00:00`;
  const hi = `${shiftDateStr(to, 2)} 00:00:00`;

  // Subqueries name the outer row as `tasks.id`; drizzle's column would render unqualified.
  const rows = await db
    .select({
      id: tasksTable.id,
      boardId: tasksTable.boardId,
      title: tasksTable.title,
      counterValue: tasksTable.counterValue,
      dueDatetime: tasksTable.dueDatetime,
      dueHasTime: tasksTable.dueHasTime,
      dueAsap: tasksTable.dueAsap,
      completedAt: tasksTable.completedAt,
      openSubtasks: sql<number>`(SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id AND c.completed_at IS NULL)`,
      color: sql<string | null>`(SELECT t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = tasks.id ORDER BY t.order_index, t.id LIMIT 1)`,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, userId),
        or(
          and(gte(tasksTable.dueDatetime, lo), lt(tasksTable.dueDatetime, hi)),
          and(eq(tasksTable.dueAsap, 1), isNull(tasksTable.completedAt))
        )
      )
    );

  const timeZone = await getViewerTimeZone();
  return bucketCalendarTasks(rows, { from, to, today: dateStrInTimeZone(timeZone), timeZone });
}
