import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TasksClient from './TasksClient';
import {
  ensureDefaultBoard,
  getBoards,
  getTagsByTask,
  getTaskRows,
  getTaskTagOptions,
} from '@/features/tasks/server/queries';
import {
  MAX_VISIBLE_BOARDS,
  REMINDERS_ONLY_COOKIE,
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

  const boards = await getBoards(session.userId);

  // Where a virtual list's composer writes. An account that has never chosen
  // one falls back to the top of the rail, which is what it always did.
  const defaultBoard = boards.find((b) => b.isDefault === 1) ?? boards[0];

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

  const remindersOnly = (await cookies()).get(REMINDERS_ONLY_COOKIE)?.value === '1';

  const rows = await getTaskRows(session.userId, boardScope);

  // Tags available to tasks, and which tasks carry them. Two small queries
  // rather than a join, so a task with three tags doesn't triple its row.
  const availableTags = await getTaskTagOptions(session.userId);
  const tagsByTask = await getTagsByTask(rows.map((r) => r.id));

  return (
    <TasksClient
      availableTags={availableTags}
      tagsByTask={tagsByTask}
      boards={boards.map((b) => ({ id: b.id, name: b.name, isDefault: b.id === defaultBoard.id }))}
      visibleBoards={
        virtual
          ? [
              {
                // A list that isn't a list still has to answer "where does a
                // new task go". It goes to the default board, and the composer
                // says so by name rather than leaving you to find out.
                id: defaultBoard.id,
                name: VIRTUAL_LIST_NAMES[virtual],
                sortMode: virtualSort,
                virtual,
                targetName: defaultBoard.name,
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
      remindersOnly={remindersOnly}
    />
  );
}
