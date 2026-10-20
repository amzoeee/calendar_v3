import { describe, expect, it } from 'vitest';
import {
  buildTaskTree,
  completedRenderRows,
  countOpenDescendants,
  flattenTaskTree,
  hasOpenDescendants,
  sortTasksFlat,
  sortTaskTree,
  type TaskRenderRow,
  type TaskRow,
} from './tasks';

const row = (id: number, over: Partial<TaskRow> = {}): TaskRow => ({
  id,
  boardId: 1,
  parentId: null,
  depth: 0,
  orderIndex: id,
  title: `t${id}`,
  description: null,
  dueDatetime: null,
  dueHasTime: 0,
  dueAsap: 0,
  remindAt: null,
  remindOffsetMinutes: null,
  remindOffsetDays: null,
  remindTimeOfDay: null,
  isStarred: 0,
  completedAt: null,
  rrule: null,
  counterValue: null,
  counterEnd: null,
  createdAt: null,
  ...over,
});

const ids = (rows: TaskRenderRow[]): unknown[] =>
  rows.map((r) => (r.children.length ? [r.node.id, ids(r.children)] : r.node.id));

describe('buildTaskTree', () => {
  it('nests children under their parent', () => {
    const tree = buildTaskTree([row(1), row(2, { parentId: 1 }), row(3)]);
    expect(tree.map((n) => [n.id, n.children.map((c) => c.id)])).toEqual([
      [1, [2]],
      [3, []],
    ]);
  });

  it('promotes a task whose parent is missing instead of dropping it', () => {
    expect(buildTaskTree([row(2, { parentId: 99 })]).map((n) => n.id)).toEqual([2]);
  });
});

describe('sortTaskTree', () => {
  it('puts ASAP first and undated last when sorting by deadline', () => {
    const tree = buildTaskTree([
      row(1),
      row(2, { dueDatetime: '2026-10-20 09:00:00' }),
      row(3, { dueAsap: 1 }),
      row(4, { dueDatetime: '2026-10-18 09:00:00' }),
    ]);
    expect(sortTaskTree(tree, 'deadline').map((n) => n.id)).toEqual([3, 4, 2, 1]);
  });

  it('sorts alphabetically ignoring case', () => {
    const tree = buildTaskTree([row(1, { title: 'banana' }), row(2, { title: 'Apple' })]);
    expect(sortTaskTree(tree, 'alpha').map((n) => n.id)).toEqual([2, 1]);
  });

  it('sorts newest first by creation', () => {
    const tree = buildTaskTree([row(1, { createdAt: '2026-01-01' }), row(2, { createdAt: '2026-02-01' })]);
    expect(sortTaskTree(tree, 'created').map((n) => n.id)).toEqual([2, 1]);
  });

  it('sorts every level', () => {
    const tree = buildTaskTree([row(1), row(3, { parentId: 1, orderIndex: 2 }), row(2, { parentId: 1, orderIndex: 1 })]);
    expect(sortTaskTree(tree, 'manual')[0].children.map((n) => n.id)).toEqual([2, 3]);
  });
});

describe('sortTasksFlat', () => {
  it('keeps a subtask due the same day nested and detaches one due another day', () => {
    const tree = buildTaskTree([
      row(1, { dueDatetime: '2026-10-20 17:00:00' }),
      row(2, { parentId: 1, dueDatetime: '2026-10-20 09:00:00' }),
      row(3, { parentId: 1, dueDatetime: '2026-10-18 09:00:00' }),
    ]);
    expect(ids(sortTasksFlat(tree, 'deadline'))).toEqual([3, [1, [2]]]);
  });

  it('never groups in alphabetical mode', () => {
    const tree = buildTaskTree([row(1, { title: 'b' }), row(2, { parentId: 1, title: 'a' })]);
    expect(ids(sortTasksFlat(tree, 'alpha'))).toEqual([2, 1]);
  });
});

describe('completedRenderRows', () => {
  it('lists newest first and keeps same-day subtasks with their parent', () => {
    const tree = buildTaskTree([
      row(1, { completedAt: '2026-10-18 10:00:00' }),
      row(2, { parentId: 1, completedAt: '2026-10-18 09:00:00' }),
      row(3, { completedAt: '2026-10-19 10:00:00' }),
    ]);
    expect(ids(completedRenderRows(tree))).toEqual([3, [1, [2]]]);
  });
});

describe('descendant helpers', () => {
  const [parent] = buildTaskTree([
    row(1),
    row(2, { parentId: 1, completedAt: '2026-10-18' }),
    row(3, { parentId: 1 }),
  ]);

  it('flattens depth first', () => {
    expect(flattenTaskTree([parent]).map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('counts open subtasks', () => {
    expect(hasOpenDescendants(parent)).toBe(true);
    expect(countOpenDescendants(parent)).toBe(1);
  });
});
