'use client';

import { useState, type ReactNode } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { SORT_LABELS, type SortMode } from '@/lib/tasks';
import {
  restoreTasksAction,
  restoreBoardAction,
  setDefaultBoardAction,
  deleteBoardAction,
  deleteCompletedTasksAction,
} from '@/features/tasks/server/actions';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { useUndo } from '@/app/components/UndoToast';
import { type BoardSummary, type VisibleBoard, type ColumnHandlers } from '../types';

/** A board column's "…" menu: paste, rename, default, and the two deletes. */
export default function ColumnMenu({
  board,
  boards,
  taskCount,
  completedCount,
  collapsed,
  activeFilters,
  hasFilterables,
  filterOptions,
  sortModes,
  changeSort,
  run,
  onPickBoard,
  onPaste,
  onRename,
}: {
  board: VisibleBoard;
  boards: BoardSummary[];
  taskCount: number;
  completedCount: number;
  collapsed: boolean;
  activeFilters: number;
  hasFilterables: boolean;
  filterOptions: ReactNode;
  sortModes: readonly SortMode[];
  changeSort: (mode: SortMode) => void;
  run: ColumnHandlers['run'];
  onPickBoard: (id: number) => void;
  onPaste: () => void;
  onRename: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { confirm, choose } = useConfirm();
  const { raiseUndo } = useUndo();

  const isDefaultBoard = boards.some((b) => b.id === board.id && b.isDefault);

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
                onPaste();
              }}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
            >
              Paste a list…
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
            >
              Rename list
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                run(() => setDefaultBoardAction(board.id));
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
                run(async () => {
                  const snapshot = await deleteCompletedTasksAction(board.id);
                  const n = snapshot.tasks.length;
                  raiseUndo({
                    message: `Deleted ${n} completed task${n === 1 ? '' : 's'}`,
                    undo: () =>
                      run(async () => {
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
                const n = taskCount;
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
                run(async () => {
                  const snapshot = await deleteBoardAction(board.id, choice === 'move' ? others[0].id : null);
                  raiseUndo({
                    message: `Deleted “${board.name}”`,
                    undo: () =>
                      run(async () => {
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
  );
}
