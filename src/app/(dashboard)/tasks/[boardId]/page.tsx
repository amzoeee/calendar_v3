import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { taskBoards, tasks as tasksTable, taskTags, tags as tagsTable } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import TasksClient from './TasksClient';
import { ensureDefaultBoard } from '@/app/task-actions';
import { MAX_VISIBLE_BOARDS, type SortMode } from '@/lib/tasks';

interface PageProps {
  params: Promise<{ boardId: string }> | { boardId: string };
}

export default async function TasksBoardPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { boardId: boardIdParam } = await params;

  await ensureDefaultBoard(session.userId);

  const boards = await db
    .select()
    .from(taskBoards)
    .where(eq(taskBoards.userId, session.userId))
    .orderBy(asc(taskBoards.orderIndex), asc(taskBoards.id));

  // The segment carries one board id, or several comma-separated ones for a
  // side-by-side view ("/tasks/1,3"). Unknown ids are dropped rather than
  // 404ing, the same forgiving treatment the date views give a bad date.
  const requested = decodeURIComponent(boardIdParam)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id));

  const seen = new Set<number>();
  const selected = requested
    .filter((id) => {
      if (seen.has(id) || !boards.some((b) => b.id === id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_VISIBLE_BOARDS)
    .map((id) => boards.find((b) => b.id === id)!);

  if (selected.length === 0) redirect(`/tasks/${boards[0].id}`);

  // Normalise the URL when it named more boards than we show, or repeated one.
  const canonical = selected.map((b) => b.id).join(',');
  if (canonical !== decodeURIComponent(boardIdParam)) redirect(`/tasks/${canonical}`);

  // A flat list across every visible board, ordered by sibling position. The
  // client assembles the tree — see buildTaskTree in lib/tasks.ts for why the
  // nesting isn't done here.
  const rows = await db
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
      remindAt: tasksTable.remindAt,
      isStarred: tasksTable.isStarred,
      completedAt: tasksTable.completedAt,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, session.userId),
        inArray(
          tasksTable.boardId,
          selected.map((b) => b.id)
        )
      )
    )
    .orderBy(asc(tasksTable.orderIndex), asc(tasksTable.id));

  // Tags available to tasks, and which tasks carry them. Two small queries
  // rather than a join, so a task with three tags doesn't triple its row.
  const availableTags = await db
    .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color })
    .from(tagsTable)
    .where(
      and(
        eq(tagsTable.userId, session.userId),
        eq(tagsTable.isArchived, 0),
        inArray(tagsTable.scope, ['task', 'both'])
      )
    )
    .orderBy(asc(tagsTable.orderIndex), asc(tagsTable.id));

  const taskIds = rows.map((r) => r.id);
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

  return (
    <TasksClient
      availableTags={availableTags}
      tagsByTask={tagsByTask}
      boards={boards.map((b) => ({ id: b.id, name: b.name }))}
      visibleBoards={selected.map((b) => ({
        id: b.id,
        name: b.name,
        sortMode: b.sortMode as SortMode,
      }))}
      rows={rows}
    />
  );
}
