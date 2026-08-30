// Shared task helpers: the nesting limit, the flat-list -> tree assembly, and
// sorting. Deliberately free of DB imports so client components can use it too.

/**
 * How deep tasks are allowed to nest. 0 = top level, so 1 permits a single
 * level of subtasks (the Google Tasks shape).
 *
 * The database has no opinion about this — `tasks.parentId` is an ordinary
 * self-reference and the queries that walk it are recursive. Raising this
 * number is the whole change on the backend; the front end additionally needs
 * its indent affordance to offer the extra depth.
 */
export const MAX_TASK_DEPTH = 1;

/**
 * How many boards can sit side by side in the desktop view. Past three the
 * columns get too narrow for a task title to survive on one line at common
 * window widths.
 */
export const MAX_VISIBLE_BOARDS = 3;

/**
 * Which lists were last shown side by side, mirrored into a cookie so the
 * /tasks redirect can restore them on the server. A cookie rather than
 * localStorage because the decision is made before the client runs.
 */
export const VISIBLE_BOARDS_COOKIE = 'taskBoards';

export type SortMode = 'manual' | 'alpha' | 'created' | 'remind' | 'deadline';

export const ACTIVE_SORT_MODES: SortMode[] = [
  'manual',
  'alpha',
  'created',
  'deadline',
  'remind',
];

export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'My order',
  alpha: 'Alphabetical',
  created: 'Date created',
  remind: 'Reminder',
  deadline: 'Deadline',
};

/**
 * Lists that aren't lists: a view over every board rather than a row in
 * task_boards. "All tasks" answers "what do I owe in total", "Starred" shows
 * what you singled out, wherever it lives.
 */
export const VIRTUAL_LISTS = ['all', 'starred'] as const;
export type VirtualList = (typeof VIRTUAL_LISTS)[number];

export const VIRTUAL_LIST_NAMES: Record<VirtualList, string> = {
  all: 'All tasks',
  starred: 'Starred',
};

export function isVirtualList(value: string): value is VirtualList {
  return (VIRTUAL_LISTS as readonly string[]).includes(value);
}

/**
 * Where a virtual list keeps its sort mode.
 *
 * `sortMode` is a column on task_boards and these have no row there, so it
 * goes in a cookie instead — one per list, the same trick the visible-board
 * set uses: written by the client, read on the server so the first paint is
 * already sorted. A cookie is also the more honest home for it. A board's sort
 * is a property of that board; how you like to read a cross-board view is a
 * property of the viewer.
 */
export const VIRTUAL_SORT_COOKIE_PREFIX = 'taskSort_';

/**
 * Manual order is scoped to (board, parent) — two tasks on different boards
 * have no order relative to each other — so a virtual list can't offer it,
 * and can't be dragged into one either.
 */
export const VIRTUAL_SORT_MODES: SortMode[] = ACTIVE_SORT_MODES.filter((m) => m !== 'manual');

export const DEFAULT_VIRTUAL_SORT: SortMode = 'deadline';

export interface TaskRow {
  id: number;
  boardId: number;
  parentId: number | null;
  depth: number;
  orderIndex: number;
  title: string;
  description: string | null;
  dueDatetime: string | null;
  dueHasTime: number;
  remindAt: string | null;
  remindOffsetMinutes: number | null;
  remindOffsetDays: number | null;
  remindTimeOfDay: string | null;
  isStarred: number;
  completedAt: string | null;
  rrule: string | null;
  counterValue: number | null;
  counterEnd: number | null;
  createdAt: string | null;
}

export interface TaskNode extends TaskRow {
  children: TaskNode[];
}

/**
 * Assemble a flat row list into a forest.
 *
 * The server deliberately sends a flat list rather than pre-nested
 * `parent.subtasks` objects: a flat list plus this function is depth-agnostic,
 * so raising MAX_TASK_DEPTH doesn't ripple through every consumer.
 *
 * Rows whose parent is missing from the list (filtered out, or on another
 * board) are promoted to the top level rather than dropped, so a task can
 * never become invisible.
 */
export function buildTaskTree(rows: TaskRow[]): TaskNode[] {
  const nodes = new Map<number, TaskNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  const roots: TaskNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId != null ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function compare(a: TaskNode, b: TaskNode, mode: SortMode): number {
  switch (mode) {
    case 'alpha':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'created':
      // Newest first, matching where the composer puts new tasks.
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id;
    case 'deadline':
    case 'remind': {
      // Undated tasks sink to the bottom rather than sorting as "earliest".
      const key = mode === 'deadline' ? 'dueDatetime' : 'remindAt';
      const av = a[key];
      const bv = b[key];
      if (av && bv) return av.localeCompare(bv);
      if (av) return -1;
      if (bv) return 1;
      return a.orderIndex - b.orderIndex;
    }
    case 'manual':
    default:
      return a.orderIndex - b.orderIndex;
  }
}

/** Sort a forest in place, at every level. */
export function sortTaskTree(nodes: TaskNode[], mode: SortMode): TaskNode[] {
  nodes.sort((a, b) => compare(a, b, mode));
  for (const node of nodes) sortTaskTree(node.children, mode);
  return nodes;
}

/** Depth-first flatten, for rendering a tree as rows. */
export function flattenTaskTree(nodes: TaskNode[]): TaskNode[] {
  const out: TaskNode[] = [];
  const walk = (list: TaskNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** True when the node has at least one incomplete descendant. */
export function hasOpenDescendants(node: TaskNode): boolean {
  return node.children.some((c) => !c.completedAt || hasOpenDescendants(c));
}

export function countOpenDescendants(node: TaskNode): number {
  return node.children.reduce(
    (n, c) => n + (c.completedAt ? 0 : 1) + countOpenDescendants(c),
    0
  );
}
