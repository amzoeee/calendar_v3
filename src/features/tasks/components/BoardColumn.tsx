'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePreservedScroll } from '@/lib/usePreservedScroll';
import {
  Bell,
  Check,
  CornerDownRight,
  ListChecks,
  MoreHorizontal,
  Tag as TagIcon,
} from 'lucide-react';
import {
  buildTaskTree,
  sortTaskTree,
  flattenTaskTree,
  isFlatSort,
  sortTasksFlat,
  nestedRenderRows,
  completedRenderRows,
  ACTIVE_SORT_MODES,
  SORT_LABELS,
  MAX_TASK_DEPTH,
  VIRTUAL_LISTS,
  VIRTUAL_LIST_NAMES,
  VIRTUAL_SORT_MODES,
  isVirtualList,
  type SortMode,
  type VirtualList,
  type TaskRow,
  type TaskNode,
  type TaskRenderRow,
} from '@/lib/tasks';
import {
  restoreTasksAction,
  restoreBoardAction,
  renameBoardAction,
  setDefaultBoardAction,
  deleteBoardAction,
  setBoardSortAction,
  deleteCompletedTasksAction,
  createTasksBulkAction,
} from '@/features/tasks/server/actions';
import { displayTitle } from '@/lib/taskSchedule';
import Select from '@/app/components/Select';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { useUndo } from '@/app/components/UndoToast';
import { hasActiveReminder } from '../reminders';
import { type BoardSummary, type VisibleBoard, type TaskTag, type ColumnHandlers } from '../types';
import PasteListDialog from './PasteListDialog';
import BoardNameDialog from './BoardNameDialog';
import TaskComposer from './TaskComposer';
import CompletedSection from './CompletedSection';
import TaskItem from './TaskItem';
import FilterOptions from './FilterOptions';

/**
 * One board's column: its own header, composer, list and Completed section.
 * Everything that can only be true of one task at a time (which row is being
 * renamed, which has the subtask composer open) lives in the parent; state
 * that is genuinely per-column lives here.
 */
export default function BoardColumn({
  board,
  boards,
  rows,
  availableTags,
  handlers,
  collapsed,
  registerComposer,
  onPickBoard,
  onPickList,
  onNewBoard,
  isPrimary,
}: {
  board: VisibleBoard;
  boards: BoardSummary[];
  rows: TaskRow[];
  availableTags: TaskTag[];
  handlers: ColumnHandlers;
  collapsed: boolean;
  registerComposer: (boardId: number, el: HTMLInputElement | null) => void;
  onPickBoard: (id: number) => void;
  onPickList: (kind: VirtualList) => void;
  onNewBoard: () => void;
  isPrimary: boolean;
}) {
  const [subtaskValue, setSubtaskValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pasting, setPasting] = useState(false);
  const { confirm, choose } = useConfirm();
  const { raiseUndo } = useUndo();
  const [filterTagIds, setFilterTagIds] = useState<number[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);

  const subtaskRef = useRef<HTMLInputElement>(null);

  // Keyed by the list this column is showing, not by its position, so that
  // switching board — which remounts the page — puts each column back where it
  // was rather than dropping another list's offset onto it.
  const columnScrollRef = usePreservedScroll<HTMLDivElement>(
    `tasks:column:${board.virtual ?? board.id}`,
  );

  // The Starred list is the starred filter, applied to every board. Reusing
  // the filter rather than narrowing the query is what keeps a match's family
  // with it — see the filtering note below.
  const starredList = board.virtual === 'starred';
  const starredFilter = starredList || starredOnly;

  // Which list a task actually belongs to only needs saying in a view that
  // spans several.
  const boardNames = useMemo(() => new Map(boards.map((b) => [b.id, b.name])), [boards]);

  const isDefaultBoard = boards.some((b) => b.id === board.id && b.isDefault);

  const { subtaskParent, setSubtaskParent } = handlers;

  useEffect(() => {
    if (subtaskParent != null && rows.some((r) => r.id === subtaskParent)) {
      subtaskRef.current?.focus();
    }
  }, [subtaskParent, rows]);

  // Only the tags actually in use on this list. Derived rather than
  // configured, so the menu stays short by construction and never lists a tag
  // that would filter everything away.
  const tagsInUse = useMemo(() => {
    const present = new Set<number>();
    for (const r of rows) for (const t of handlers.tagsFor(r.id)) present.add(t.id);
    return availableTags.filter((t) => present.has(t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, availableTags]);

  // The badge counts filters *you* applied; the Starred list's own filter is
  // the list, not something to clear.
  const { remindersOnly, setRemindersOnly } = handlers;
  const activeFilters = filterTagIds.length + (starredOnly ? 1 : 0);
  const filtering = filterTagIds.length > 0 || starredFilter || remindersOnly;
  const filteredOut = activeFilters > 0 || remindersOnly;

  /**
   * Filtering keeps a matching task's family with it, in both directions:
   *
   * - **Ancestors**, so a matching subtask still appears under its parent. On
   *   its own a matched subtask loses the only thing that said what it was
   *   part of.
   * - **Descendants**, so a matched task is never shown looking childless.
   *
   * A task is therefore shown when it matches, when anything in its subtree
   * matches, or when any of its ancestors match.
   *
   * Active reminders only is the exception on the ancestor side: a parent
   * without one of its own stays out, and its subtask shows flush with the
   * parent's name above it.
   */
  const visibleRows = useMemo(() => {
    if (!filtering) return rows;

    const matches = (r: TaskRow) => {
      if (starredFilter && !r.isStarred) return false;
      if (remindersOnly && !hasActiveReminder(r)) return false;
      if (filterTagIds.length === 0) return true;
      // OR across selected tags: a task matches if it carries any of them.
      return handlers.tagsFor(r.id).some((t) => filterTagIds.includes(t.id));
    };

    const byId = new Map(rows.map((r) => [r.id, r]));
    const keep = new Set<number>();

    for (const row of rows) {
      if (!matches(row)) continue;
      keep.add(row.id);
      for (let p = row.parentId; p != null; p = byId.get(p)?.parentId ?? null) {
        if (keep.has(p) || !byId.has(p)) break;
        if (remindersOnly && !hasActiveReminder(byId.get(p)!)) break;
        keep.add(p);
      }
    }

    // Descendants of anything matched. Walked breadth-first rather than
    // recursively so it stays correct at any depth.
    let frontier = rows.filter((r) => matches(r)).map((r) => r.id);
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const row of rows) {
        if (row.parentId != null && frontier.includes(row.parentId) && !keep.has(row.id)) {
          keep.add(row.id);
          next.push(row.id);
        }
      }
      frontier = next;
    }

    return rows.filter((r) => keep.has(r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filterTagIds, starredFilter, remindersOnly, filtering]);

  const { openTree, completedTree } = useMemo(() => {
    const open = visibleRows.filter((r) => !r.completedAt);
    const done = visibleRows.filter((r) => r.completedAt);
    return {
      openTree: sortTaskTree(buildTaskTree(open), board.sortMode),
      // Ordering happens in `completedRows`, which reads this pile as the log
      // it is rather than as a list you're working through.
      completedTree: buildTaskTree(done),
    };
  }, [visibleRows, board.sortMode]);

  const openCount = useMemo(() => flattenTaskTree(openTree).length, [openTree]);

  /**
   * What the open list actually draws.
   *
   * Under manual order that's the tree, nesting and all. Under any other sort
   * a subtask is sorted against every task rather than only against its
   * siblings, so it lands where its own deadline says it should — unless it
   * shares its parent's day, where staying nested says more. A detached row
   * names its parent in grey above the title, which is all the indent was
   * saying.
   */
  const flatSort = isFlatSort(board.sortMode);
  const openRender = useMemo(
    () => (flatSort ? sortTasksFlat(openTree, board.sortMode) : nestedRenderRows(openTree)),
    [openTree, board.sortMode, flatSort]
  );

  // The completed pile is a log — newest first, whatever the board's sort is —
  // so it detaches on the same terms, by the day things were finished.
  const completedRender = useMemo(() => completedRenderRows(completedTree), [completedTree]);
  const completedCount = useMemo(() => flattenTaskTree(completedTree).length, [completedTree]);

  /** Titles of every task on this column, for a subtask row's grey parent line. */
  const titleById = useMemo(
    () => new Map(rows.map((r) => [r.id, displayTitle(r.title, r.counterValue)])),
    [rows]
  );

  /** The list `id` sits in, at whatever depth it lives. */
  const siblingListOf = (id: number): TaskNode[] | null => {
    const walk = (list: TaskNode[]): TaskNode[] | null => {
      if (list.some((n) => n.id === id)) return list;
      for (const n of list) {
        const found = walk(n.children);
        if (found) return found;
      }
      return null;
    };
    return walk(openTree);
  };

  /**
   * Keyboard equivalents of the drag gestures, available while renaming a row.
   * Written against parent/child rather than "top level vs subtask" so they
   * keep working if MAX_TASK_DEPTH is ever raised.
   */
  const keyboardMove = (node: TaskNode, action: 'up' | 'down' | 'indent' | 'outdent') => {
    const siblings = siblingListOf(node.id);
    if (!siblings) return;
    const ids = siblings.map((n) => n.id);
    const i = ids.indexOf(node.id);

    if (action === 'up' || action === 'down') {
      const j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      const next = [...ids];
      next.splice(i, 1);
      next.splice(j, 0, node.id);
      handlers.moveTask(node.id, {
        boardId: board.id,
        parentId: node.parentId,
        siblingIds: next,
      });
      return;
    }

    if (action === 'indent') {
      const prev = siblings[i - 1];
      // Only a leaf can be indented — a task with children would take them
      // past the depth limit along with it.
      if (!prev || node.children.length > 0 || node.depth >= MAX_TASK_DEPTH) return;
      handlers.moveTask(node.id, {
        boardId: board.id,
        parentId: prev.id,
        siblingIds: [...prev.children.map((c) => c.id), node.id],
      });
      return;
    }

    if (node.parentId == null) return;
    const parentSiblings = siblingListOf(node.parentId);
    if (!parentSiblings) return;
    const parentNode = parentSiblings.find((n) => n.id === node.parentId)!;
    const next = parentSiblings.map((n) => n.id);
    // Lands immediately after what used to be its parent.
    next.splice(next.indexOf(parentNode.id) + 1, 0, node.id);
    handlers.moveTask(node.id, {
      boardId: board.id,
      parentId: parentNode.parentId,
      siblingIds: next,
    });
  };

  // `level` is the row's position in the list being rendered — see TaskItem.
  const renderRow = (row: TaskRenderRow, done: boolean, level = 0) => {
    const node = row.node;
    const indent = level * 24;
    // A row drawn flush that has a parent somewhere else in the list names it.
    const parentTitle = level === 0 && node.parentId != null ? titleById.get(node.parentId) : undefined;

    return (
      <div key={node.id}>
        <TaskItem
          node={node}
          done={done}
          level={level}
          virtual={Boolean(board.virtual)}
          boardName={board.virtual ? boardNames.get(node.boardId) : undefined}
          parentTitle={parentTitle}
          handlers={handlers}
          onMove={board.virtual ? undefined : (action) => keyboardMove(node, action)}
          onAddSubtask={() => {
            setSubtaskParent(node.id);
            setSubtaskValue('');
          }}
        />

        {subtaskParent === node.id && (
          <div className="flex items-center gap-2.5 py-1" style={{ paddingLeft: 22 + indent + 24 }}>
            <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={subtaskRef}
              value={subtaskValue}
              onChange={(e) => setSubtaskValue(e.target.value)}
              onBlur={() => {
                handlers.addTask(node.boardId, subtaskValue, node.id);
                setSubtaskParent(null);
                setSubtaskValue('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlers.addTask(node.boardId, subtaskValue, node.id);
                  setSubtaskValue('');
                }
                if (e.key === 'Escape') setSubtaskParent(null);
              }}
              placeholder="Subtask"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none border-b border-border focus:border-foreground py-1"
            />
          </div>
        )}

        {row.children.map((child) =>
          renderRow(child, Boolean(child.node.completedAt), level + 1)
        )}
      </div>
    );
  };

  const hasFilterables =
    tagsInUse.length > 0 ||
    (!starredList && (starredOnly || rows.some((r) => r.isStarred)));

  // Sort and filter are rendered either as their own header controls or as
  // sections of the overflow menu, depending on how much room the column has.
  // Defined once here so the two placements can't drift apart.
  // A virtual list can't offer My order: orderIndex is scoped to a board and a
  // parent, so two tasks on different boards have no order between them. Its
  // choice goes to a cookie rather than a task_boards row.
  const sortModes = board.virtual ? VIRTUAL_SORT_MODES : ACTIVE_SORT_MODES;
  const changeSort = (mode: SortMode) => {
    if (board.virtual) handlers.setVirtualSort(board.virtual, mode);
    else handlers.run(() => setBoardSortAction(board.id, mode));
  };

  const filterOptions = (
    <FilterOptions
      starredList={starredList}
      starredOnly={starredOnly}
      setStarredOnly={setStarredOnly}
      remindersOnly={remindersOnly}
      setRemindersOnly={setRemindersOnly}
      tags={tagsInUse}
      filterTagIds={filterTagIds}
      setFilterTagIds={setFilterTagIds}
      activeFilters={activeFilters}
    />
  );

  const sortOptions = (
    <>
      {sortModes.map((mode) => (
        <button
          key={mode}
          onClick={() => {
            setMenuOpen(false);
            changeSort(mode);
          }}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
        >
          <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
            {board.sortMode === mode && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          {SORT_LABELS[mode]}
        </button>
      ))}
    </>
  );

  const sectionLabel = (text: string) => (
    <p className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {text}
    </p>
  );

  return (
    <div
      data-board-column
      data-board-id={board.id}
      className={`flex-1 min-w-0 flex flex-col ${isPrimary ? '' : 'hidden md:flex'}`}
    >
      <div className="shrink-0 border-b border-border px-3 md:px-4 py-3 flex items-center gap-2">
        {/* Mobile shows one list at a time, chosen here. */}
        <div className="md:hidden flex-1 min-w-0">
          <Select<string | number>
            value={board.virtual ?? board.id}
            onChange={(value) => {
              if (value === 'new') onNewBoard();
              else if (typeof value === 'string' && isVirtualList(value)) onPickList(value);
              else onPickBoard(Number(value));
            }}
            aria-label="Choose a list"
            className="w-full bg-transparent text-lg font-bold text-foreground focus:outline-none cursor-pointer"
            options={[
              ...VIRTUAL_LISTS.map((kind) => ({ value: kind, label: VIRTUAL_LIST_NAMES[kind] })),
              ...boards.map((b) => ({ value: b.id, label: b.name })),
              { value: 'new', label: '+ New list…' },
            ]}
          />
        </div>

        <h2 className="hidden md:block flex-1 min-w-0 truncate text-base font-bold text-foreground">
          {board.name}
          {openCount > 0 && (
            <span className="ml-2 text-xs font-medium text-muted-foreground">{openCount}</span>
          )}
        </h2>

        {!collapsed && (
          <div className={`relative shrink-0 ${hasFilterables ? '' : 'md:hidden'}`}>
            <button
              onClick={() => setFilterOpen((o) => !o)}
              aria-expanded={filterOpen}
              aria-label={`Filter ${board.name}`}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors cursor-pointer ${
                activeFilters > 0
                  ? 'bg-secondary border-foreground/30 text-foreground'
                  : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <TagIcon className="h-3 w-3" />
              {activeFilters > 0 ? activeFilters : 'Filter'}
              {/* Mobile has no rail to show the toggle is on. */}
              {remindersOnly && <Bell className="h-3 w-3 md:hidden" />}
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 z-50 bg-card border border-border rounded-lg shadow-2xl p-1 max-h-72 overflow-y-auto">
                  {filterOptions}
                </div>
              </>
            )}
          </div>
        )}

        {!collapsed && (
          <Select
            value={board.sortMode}
            onChange={changeSort}
            aria-label={`Sort ${board.name}`}
            className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[7.5rem]"
            options={sortModes.map((mode) => ({ value: mode, label: SORT_LABELS[mode] }))}
          />
        )}

        {/* Everything in this menu acts on a board — renaming it, pasting into
            it, deleting it — so a virtual list has no use for it. Its sort and
            filter live in the header, since it's never shown alongside
            another column. */}
        {!board.virtual && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={`${board.name} options`}
            aria-expanded={menuOpen}
            className="relative p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <MoreHorizontal className="h-4 w-4" />
            {/* With the filter folded away, this dot is the only thing saying
                the list is showing a subset. */}
            {collapsed && activeFilters > 0 && (
              <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-foreground" />
            )}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-52 z-50 bg-card border border-border rounded-lg shadow-2xl p-1 max-h-[70vh] overflow-y-auto">
                {/* Side by side, the columns are too narrow for their own sort
                    and filter controls, so both fold in here. */}
                {collapsed && (
                  <>
                    {sectionLabel('Sort')}
                    {sortOptions}
                    <div className={hasFilterables ? '' : 'md:hidden'}>
                      <div className="my-1 border-t border-border" />
                      {sectionLabel('Filter')}
                      {filterOptions}
                    </div>
                    <div className="my-1 border-t border-border" />
                  </>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setPasting(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
                >
                  Paste a list…
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
                >
                  Rename list
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handlers.run(() => setDefaultBoardAction(board.id));
                  }}
                  disabled={isDefaultBoard}
                  title="Where All tasks and Starred add a new task"
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isDefaultBoard ? 'Default list' : 'Make default list'}
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (completedCount === 0) return;
                    const ok = await confirm({
                      title: `Delete ${completedCount} completed task${completedCount === 1 ? '' : 's'}?`,
                      message: `They’ll be removed from “${board.name}”. Your stats keep the history.`,
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    handlers.run(async () => {
                      const snapshot = await deleteCompletedTasksAction(board.id);
                      const n = snapshot.tasks.length;
                      raiseUndo({
                        message: `Deleted ${n} completed task${n === 1 ? '' : 's'}`,
                        undo: () =>
                          handlers.run(async () => {
                            const res = await restoreTasksAction(snapshot);
                            if (res.error) raiseUndo({ message: `Couldn’t undo: ${res.error.toLowerCase()}`, undo: null });
                          }),
                      });
                    });
                  }}
                  disabled={completedCount === 0}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Delete completed
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    const others = boards.filter((b) => b.id !== board.id);
                    const n = rows.length;
                    const choice =
                      n === 0
                        ? await choose({
                            title: `Delete “${board.name}”?`,
                            choices: [{ label: 'Delete list', value: 'delete' as const, tone: 'danger' }],
                          })
                        : await choose({
                            title: `Delete “${board.name}”?`,
                            message: `It has ${n} task${n === 1 ? '' : 's'}. Move ${n === 1 ? 'it' : 'them'} to “${others[0].name}”, or delete ${n === 1 ? 'it' : 'them'} with the list?`,
                            choices: [
                              { label: `Delete ${n === 1 ? 'task' : 'tasks'}`, value: 'delete' as const, tone: 'danger' },
                              { label: `Move ${n === 1 ? 'task' : 'tasks'}`, value: 'move' as const, tone: 'primary' },
                            ],
                          });
                    if (!choice) return;
                    handlers.run(async () => {
                      const snapshot = await deleteBoardAction(board.id, choice === 'move' ? others[0].id : null);
                      raiseUndo({
                        message: `Deleted “${board.name}”`,
                        undo: () =>
                          handlers.run(async () => {
                            await restoreBoardAction(snapshot);
                            onPickBoard(board.id);
                          }),
                      });
                    });
                    onPickBoard(others[0].id);
                  }}
                  disabled={boards.length <= 1}
                  title={boards.length <= 1 ? 'Your only list can’t be deleted' : undefined}
                  className="w-full text-left px-3 py-2 text-sm rounded text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-red-400"
                >
                  Delete list
                </button>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {pasting && (
        <PasteListDialog
          onCancel={() => setPasting(false)}
          onCreate={(items) => {
            setPasting(false);
            handlers.run(() => createTasksBulkAction(board.id, items));
          }}
        />
      )}

      {renaming && (
        <BoardNameDialog
          heading="Rename list"
          initialValue={board.name}
          submitLabel="Rename"
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            setRenaming(false);
            if (name !== board.name) handlers.run(() => renameBoardAction(board.id, name));
          }}
        />
      )}

      {/* The column's scroll container. Tagged so a drag reaching the top or
          bottom edge can scroll it — see useTaskDrag. */}
      <div
        ref={columnScrollRef}
        data-task-scroller
        className="flex-1 min-h-0 overflow-y-auto px-2 md:px-3 pt-1 pb-3"
      >
        <TaskComposer
          board={board}
          availableTags={availableTags}
          addTask={handlers.addTask}
          registerComposer={registerComposer}
        />

        {openRender.length === 0 && (
          <div className="py-12 text-center px-3">
            <ListChecks className="h-7 w-7 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-xs text-muted-foreground">
              {filteredOut
                ? 'No tasks match the filter.'
                : starredList
                  ? 'Nothing starred yet. Star a task and it shows up here'
                  : 'Nothing here yet. Add a task above'}
              {!filteredOut && isPrimary && (
                <>
                  , or press{' '}
                  <kbd className="px-1.5 py-0.5 rounded border border-border bg-secondary">n</kbd>
                </>
              )}
              {!filteredOut && '.'}
            </p>
          </div>
        )}

        <div className="space-y-0.5">
          {openRender.map((row) => renderRow(row, false))}
        </div>

        <CompletedSection
          count={completedCount}
          rows={completedRender}
          renderRow={(row) => renderRow(row, true)}
        />
      </div>
    </div>
  );
}
