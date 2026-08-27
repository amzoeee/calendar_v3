import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { taskBoards, tasks as tasksTable } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import TasksClient from './TasksClient';
import { ensureDefaultBoard } from '@/app/task-actions';
import type { SortMode } from '@/lib/tasks';

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

  // An unparseable or someone else's board id falls back to the first board
  // rather than 404ing — the same forgiving treatment the date views give a
  // bad date.
  const requestedId = Number(boardIdParam);
  const board = boards.find((b) => b.id === requestedId);
  if (!board) redirect(`/tasks/${boards[0].id}`);

  // A flat list, ordered by sibling position. The client assembles the tree —
  // see buildTaskTree in lib/tasks.ts for why the nesting isn't done here.
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
    .where(and(eq(tasksTable.userId, session.userId), eq(tasksTable.boardId, board.id)))
    .orderBy(asc(tasksTable.orderIndex), asc(tasksTable.id));

  return (
    <TasksClient
      boards={boards.map((b) => ({ id: b.id, name: b.name }))}
      board={{ id: board.id, name: board.name, sortMode: board.sortMode as SortMode }}
      rows={rows}
    />
  );
}
