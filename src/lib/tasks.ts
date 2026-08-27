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

export type SortMode = 'manual' | 'alpha' | 'created' | 'remind' | 'deadline';

// Sort modes offered in the UI today. `remind` and `deadline` are valid values
// the schema and sorter already understand, but there is nothing to sort by
// until deadlines land, so they stay out of the dropdown until then.
export const ACTIVE_SORT_MODES: SortMode[] = ['manual', 'alpha', 'created'];

export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'My order',
  alpha: 'Alphabetical',
  created: 'Date created',
  remind: 'Reminder',
  deadline: 'Deadline',
};

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
  isStarred: number;
  completedAt: string | null;
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
