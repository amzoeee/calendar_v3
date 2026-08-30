import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { taskBoards, tasks as tasksTable, taskTags, tags as tagsTable } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TasksClient from './TasksClient';
import { ensureDefaultBoard } from '@/app/task-actions';
import {
  MAX_VISIBLE_BOARDS,
  DEFAULT_VIRTUAL_SORT,
  VIRTUAL_LIST_NAMES,
  VIRTUAL_SORT_COOKIE_PREFIX,
  VIRTUAL_SORT_MODES,
  isVirtualList,
  type SortMode,
  type VirtualList,
} from '@/lib/tasks';

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

  const segment = decodeURIComponent(boardIdParam);

  // "/tasks/all" and "/tasks/starred" are views across every board rather than
  // boards of their own. They're shown alone — combining "everything" with one
  // list beside it would show the same tasks twice.
  const virtual: VirtualList | null = isVirtualList(segment) ? segment : null;

  // The segment otherwise carries one board id, or several comma-separated
  // ones for a side-by-side view ("/tasks/1,3"). Unknown ids are dropped
  // rather than 404ing, the same forgiving treatment the date views give a
  // bad date.
  const requested = virtual
    ? []
    : segment
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

  if (!virtual) {
    if (selected.length === 0) redirect(`/tasks/${boards[0].id}`);

    // Normalise the URL when it named more boards than we show, or repeated one.
    const canonical = selected.map((b) => b.id).join(',');
    if (canonical !== segment) redirect(`/tasks/${canonical}`);
  }

  // A virtual list reads every board. "Starred" is deliberately not narrowed
  // to starred rows here: the client's starred filter keeps a match's parents
  // and children with it, so a starred subtask still says what it belongs to
  // and a starred parent is never shown looking childless — which also stops
  // ticking one from silently completing subtasks it didn't show.
  const boardScope = virtual ? boards.map((b) => b.id) : selected.map((b) => b.id);

  // A virtual list has no task_boards row to hold a sort mode; see
  // VIRTUAL_SORT_COOKIE_PREFIX for why a cookie is where it lives.
  let virtualSort: SortMode = DEFAULT_VIRTUAL_SORT;
  if (virtual) {
    const stored = (await cookies()).get(`${VIRTUAL_SORT_COOKIE_PREFIX}${virtual}`)?.value;
    if (stored && VIRTUAL_SORT_MODES.includes(stored as SortMode)) {
      virtualSort = stored as SortMode;
    }
  }

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
        eq(tasksTable.userId, session.userId),
        inArray(tasksTable.boardId, boardScope)
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
      visibleBoards={
        virtual
          ? [
              {
                // A list that isn't a list still has to answer "where does a
                // new task go". It goes to the first board, and the composer
                // says so by name rather than leaving you to find out.
                id: boards[0].id,
                name: VIRTUAL_LIST_NAMES[virtual],
                sortMode: virtualSort,
                virtual,
                targetName: boards[0].name,
              },
            ]
          : selected.map((b) => ({
              id: b.id,
              name: b.name,
              sortMode: b.sortMode as SortMode,
              virtual: null,
              targetName: null,
            }))
      }
      rows={rows}
    />
  );
}
