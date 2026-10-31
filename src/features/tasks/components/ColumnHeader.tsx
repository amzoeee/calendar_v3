'use client';

import { useState, type ReactNode } from 'react';
import { Bell, Tag as TagIcon } from 'lucide-react';
import {
  ACTIVE_SORT_MODES,
  SORT_LABELS,
  VIRTUAL_LISTS,
  VIRTUAL_LIST_NAMES,
  VIRTUAL_SORT_MODES,
  isVirtualList,
  type SortMode,
  type VirtualList,
} from '@/lib/tasks';
import {
  renameBoardAction,
  setBoardSortAction,
  createTasksBulkAction,
} from '@/features/tasks/server/actions';
import Select from '@/app/components/Select';
import { type BoardSummary, type VisibleBoard, type ColumnHandlers } from '../types';
import PasteListDialog from './PasteListDialog';
import BoardNameDialog from './BoardNameDialog';
import ColumnMenu from './ColumnMenu';

/** A column's header — its name, filter, sort and menu — and the dialogs the menu opens. */
export default function ColumnHeader({
  board,
  boards,
  taskCount,
  openCount,
  completedCount,
  collapsed,
  filterOptions,
  activeFilters,
  hasFilterables,
  remindersOnly,
  run,
  setVirtualSort,
  onPickBoard,
  onPickList,
  onNewBoard,
}: {
  board: VisibleBoard;
  boards: BoardSummary[];
  taskCount: number;
  openCount: number;
  completedCount: number;
  collapsed: boolean;
  filterOptions: ReactNode;
  activeFilters: number;
  hasFilterables: boolean;
  remindersOnly: boolean;
  run: ColumnHandlers['run'];
  setVirtualSort: ColumnHandlers['setVirtualSort'];
  onPickBoard: (id: number) => void;
  onPickList: (kind: VirtualList) => void;
  onNewBoard: () => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pasting, setPasting] = useState(false);

  // A virtual list can't offer My order: orderIndex is scoped to a board and a
  // parent, so two tasks on different boards have no order between them. Its
  // choice goes to a cookie rather than a task_boards row.
  const sortModes = board.virtual ? VIRTUAL_SORT_MODES : ACTIVE_SORT_MODES;
  const changeSort = (mode: SortMode) => {
    if (board.virtual) setVirtualSort(board.virtual, mode);
    else run(() => setBoardSortAction(board.id, mode));
  };

  return (
    <>
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
          <ColumnMenu
            board={board}
            boards={boards}
            taskCount={taskCount}
            completedCount={completedCount}
            collapsed={collapsed}
            activeFilters={activeFilters}
            hasFilterables={hasFilterables}
            filterOptions={filterOptions}
            sortModes={sortModes}
            changeSort={changeSort}
            run={run}
            onPickBoard={onPickBoard}
            onPaste={() => setPasting(true)}
            onRename={() => setRenaming(true)}
          />
        )}
      </div>

      {pasting && (
        <PasteListDialog
          onCancel={() => setPasting(false)}
          onCreate={(items) => {
            setPasting(false);
            run(() => createTasksBulkAction(board.id, items));
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
            if (name !== board.name) run(() => renameBoardAction(board.id, name));
          }}
        />
      )}
    </>
  );
}
