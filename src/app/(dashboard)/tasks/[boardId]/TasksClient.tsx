'use client';

import React, { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  ListChecks,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildTaskTree,
  sortTaskTree,
  flattenTaskTree,
  countOpenDescendants,
  ACTIVE_SORT_MODES,
  SORT_LABELS,
  MAX_TASK_DEPTH,
  type SortMode,
  type TaskRow,
  type TaskNode,
} from '@/lib/tasks';
import {
  createTaskAction,
  updateTaskAction,
  toggleTaskCompletionAction,
  setTaskCompletionAction,
  deleteTaskAction,
  setTaskStarredAction,
  moveTaskToBoardAction,
  createBoardAction,
  renameBoardAction,
  deleteBoardAction,
  setBoardSortAction,
  deleteCompletedTasksAction,
} from '@/app/task-actions';
import { dateToServerDbString } from '@/lib/timezone';

interface BoardSummary {
  id: number;
  name: string;
}

interface TasksClientProps {
  boards: BoardSummary[];
  board: { id: number; name: string; sortMode: SortMode };
  rows: TaskRow[];
}

// What the Undo toast needs to put things back: the ids a completion toggle
// actually changed, and the state to restore them to.
interface UndoState {
  message: string;
  ids: number[];
  restoreTo: boolean;
}

export default function TasksClient({ boards, board, rows }: TasksClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Server rows are the source of truth; this mirror exists so ticking a box
  // strikes it through immediately instead of after a server round trip. The
  // reset happens during render rather than in an effect — React's documented
  // way to adjust state when props change, and it avoids a frame where the
  // list shows stale rows.
  const [localRows, setLocalRows] = useState<TaskRow[]>(rows);
  const [syncedRows, setSyncedRows] = useState<TaskRow[]>(rows);
  if (rows !== syncedRows) {
    setSyncedRows(rows);
    setLocalRows(rows);
  }

  const [composerValue, setComposerValue] = useState('');
  const [subtaskParent, setSubtaskParent] = useState<number | null>(null);
  const [subtaskValue, setSubtaskValue] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [confirmParent, setConfirmParent] = useState<{ node: TaskNode; open: number } | null>(null);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);

  const composerRef = useRef<HTMLInputElement>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- derived -----

  const { openTree, completedTree } = useMemo(() => {
    const open = localRows.filter((r) => !r.completedAt);
    const done = localRows.filter((r) => r.completedAt);
    return {
      openTree: sortTaskTree(buildTaskTree(open), board.sortMode),
      // Most recently finished first, regardless of the board's sort — the
      // completed pile reads as a log, not as a list you're working through.
      completedTree: sortTaskTree(buildTaskTree(done), 'manual').sort((a, b) =>
        (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
      ),
    };
  }, [localRows, board.sortMode]);

  const openRows = useMemo(() => flattenTaskTree(openTree), [openTree]);
  const completedRows = useMemo(() => flattenTaskTree(completedTree), [completedTree]);
  const selected = useMemo(
    () => localRows.find((r) => r.id === selectedId) ?? null,
    [localRows, selectedId]
  );

  // ----- keyboard: `n` focuses the composer -----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      composerRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (subtaskParent != null) subtaskRef.current?.focus();
  }, [subtaskParent]);

  // ----- undo toast lifetime -----

  const raiseUndo = (state: UndoState) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(state);
    undoTimer.current = setTimeout(() => setUndo(null), 7000);
  };

  const dismissUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  };

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  // ----- mutations -----

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  };

  const patchLocal = (ids: number[], patch: Partial<TaskRow>) =>
    setLocalRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r)));

  const addTask = (title: string, parentId: number | null) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    run(() => createTaskAction(board.id, trimmed, parentId));
  };

  const applyCompletion = (node: TaskNode, completed: boolean, cascade: boolean) => {
    // Optimistically strike through the whole subtree we're about to send, then
    // reconcile with the ids the server reports it actually changed.
    const optimistic = cascade
      ? flattenTaskTree([node]).filter((n) => Boolean(n.completedAt) !== completed).map((n) => n.id)
      : [node.id];
    patchLocal(optimistic, { completedAt: completed ? dateToServerDbString(new Date()) : null });
    if (completed) setShowCompleted(false);

    startTransition(async () => {
      const changed = await toggleTaskCompletionAction(node.id, completed, cascade);
      if (changed.length > 0) {
        raiseUndo({
          message: completed
            ? changed.length > 1
              ? `Completed “${node.title}” and ${changed.length - 1} subtask${changed.length > 2 ? 's' : ''}`
              : `Completed “${node.title}”`
            : `Moved “${node.title}” back to your list`,
          ids: changed,
          restoreTo: !completed,
        });
      }
      router.refresh();
    });
  };

  const requestCompletion = (node: TaskNode, completed: boolean) => {
    if (completed) {
      const open = countOpenDescendants(node);
      // Ticking a parent with unfinished subtasks is nearly always a mistake or
      // a deliberate "close it anyway" — ask rather than guessing.
      if (open > 0) {
        setConfirmParent({ node, open });
        return;
      }
    }
    applyCompletion(node, completed, true);
  };

  const undoCompletion = () => {
    if (!undo) return;
    const { ids, restoreTo } = undo;
    patchLocal(ids, { completedAt: restoreTo ? dateToServerDbString(new Date()) : null });
    dismissUndo();
    run(() => setTaskCompletionAction(ids, restoreTo));
  };

  const saveTitle = (id: number, title: string) => {
    const trimmed = title.trim();
    setEditingId(null);
    if (!trimmed) return;
    const current = localRows.find((r) => r.id === id);
    if (current?.title === trimmed) return;
    patchLocal([id], { title: trimmed });
    run(() => updateTaskAction(id, { title: trimmed }));
  };

  const toggleStar = (row: TaskRow) => {
    const next = row.isStarred ? 0 : 1;
    patchLocal([row.id], { isStarred: next });
    run(() => setTaskStarredAction(row.id, next === 1));
  };

  const removeTask = (id: number) => {
    setSelectedId(null);
    setLocalRows((prev) => prev.filter((r) => r.id !== id && r.parentId !== id));
    run(() => deleteTaskAction(id));
  };

  // ----- rendering -----

  const renderRow = (node: TaskNode, done: boolean) => {
    const isEditing = editingId === node.id;
    const indent = node.depth * 28;

    return (
      <div key={node.id}>
        <div
          className={`group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors ${
            selectedId === node.id ? 'bg-secondary' : 'hover:bg-secondary/50'
          }`}
          style={{ paddingLeft: 8 + indent }}
        >
          <button
            onClick={() => requestCompletion(node, !done)}
            aria-label={done ? `Mark “${node.title}” not done` : `Mark “${node.title}” done`}
            className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
              done
                ? 'bg-primary border-primary text-primary-foreground'
                : 'border-muted-foreground hover:border-foreground'
            }`}
          >
            {done && <Check className="h-3 w-3" strokeWidth={3} />}
          </button>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => saveTitle(node.id, editingValue)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle(node.id, editingValue);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full bg-transparent border-b border-border text-sm text-foreground focus:outline-none focus:border-foreground py-0.5"
              />
            ) : (
              <button
                onClick={() => {
                  setEditingId(node.id);
                  setEditingValue(node.title);
                }}
                className={`block w-full text-left text-sm cursor-text ${
                  done ? 'line-through text-muted-foreground' : 'text-foreground'
                }`}
              >
                {node.title}
              </button>
            )}
            {node.description && !isEditing && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{node.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {node.depth < MAX_TASK_DEPTH && !done && (
              <button
                onClick={() => {
                  setSubtaskParent(node.id);
                  setSubtaskValue('');
                }}
                aria-label={`Add a subtask to “${node.title}”`}
                title="Add subtask"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-opacity cursor-pointer p-1"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => toggleStar(node)}
              aria-label={node.isStarred ? `Unstar “${node.title}”` : `Star “${node.title}”`}
              aria-pressed={node.isStarred === 1}
              className={`p-1 transition-opacity cursor-pointer ${
                node.isStarred
                  ? 'text-amber-400'
                  : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground'
              }`}
            >
              <Star className="h-3.5 w-3.5" fill={node.isStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => setSelectedId(node.id)}
              aria-label={`Details for “${node.title}”`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground transition-opacity cursor-pointer p-1"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {subtaskParent === node.id && (
          <div className="flex items-center gap-3 py-1" style={{ paddingLeft: 8 + indent + 28 }}>
            <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={subtaskRef}
              value={subtaskValue}
              onChange={(e) => setSubtaskValue(e.target.value)}
              onBlur={() => {
                addTask(subtaskValue, node.id);
                setSubtaskParent(null);
                setSubtaskValue('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addTask(subtaskValue, node.id);
                  setSubtaskValue('');
                }
                if (e.key === 'Escape') setSubtaskParent(null);
              }}
              placeholder="Subtask"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none border-b border-border focus:border-foreground py-1"
            />
          </div>
        )}

        {node.children.map((child) => renderRow(child, Boolean(child.completedAt)))}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Boards rail (desktop) */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-border flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/tasks/${b.id}`)}
              aria-current={b.id === board.id ? 'page' : undefined}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium truncate transition-colors cursor-pointer ${
                b.id === board.id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-border">
          <button
            onClick={() => setNewBoardOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New list
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-4 md:px-8 py-4 flex items-center gap-3">
          {/* Mobile: one board at a time, chosen from a dropdown */}
          <div className="md:hidden flex-1 min-w-0">
            <select
              value={board.id}
              onChange={(e) => {
                if (e.target.value === 'new') setNewBoardOpen(true);
                else router.push(`/tasks/${e.target.value}`);
              }}
              aria-label="Choose a list"
              className="w-full bg-transparent text-lg font-bold text-foreground focus:outline-none cursor-pointer"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="new">+ New list…</option>
            </select>
          </div>

          <h1 className="hidden md:block flex-1 min-w-0 truncate text-xl font-bold text-foreground">
            {board.name}
          </h1>

          <select
            value={board.sortMode}
            onChange={(e) => run(() => setBoardSortAction(board.id, e.target.value))}
            aria-label="Sort tasks"
            className="bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            {ACTIVE_SORT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>

          <div className="relative">
            <button
              onClick={() => setBoardMenuOpen((o) => !o)}
              aria-label="List options"
              aria-expanded={boardMenuOpen}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {boardMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBoardMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 z-50 bg-card border border-border rounded-lg shadow-2xl p-1">
                  <button
                    onClick={() => {
                      setBoardMenuOpen(false);
                      const name = window.prompt('Rename list', board.name);
                      if (name && name.trim()) run(() => renameBoardAction(board.id, name));
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
                  >
                    Rename list
                  </button>
                  <button
                    onClick={() => {
                      setBoardMenuOpen(false);
                      if (completedRows.length === 0) return;
                      if (
                        window.confirm(
                          `Delete ${completedRows.length} completed task${completedRows.length === 1 ? '' : 's'} from “${board.name}”? Your stats keep the history.`
                        )
                      ) {
                        run(() => deleteCompletedTasksAction(board.id));
                      }
                    }}
                    disabled={completedRows.length === 0}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete completed
                  </button>
                  <button
                    onClick={() => {
                      setBoardMenuOpen(false);
                      if (boards.length <= 1) {
                        window.alert('This is your only list, so it can’t be deleted.');
                        return;
                      }
                      const others = boards.filter((b) => b.id !== board.id);
                      const keep =
                        localRows.length === 0 ||
                        window.confirm(
                          `“${board.name}” has ${localRows.length} task${localRows.length === 1 ? '' : 's'}.\n\nOK: move them to “${others[0].name}”.\nCancel: delete them with the list.`
                        );
                      run(async () => {
                        await deleteBoardAction(board.id, keep ? others[0].id : null);
                        router.push(`/tasks/${others[0].id}`);
                      });
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-colors cursor-pointer"
                  >
                    Delete list
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 md:px-6 py-4">
          <div className="max-w-3xl mx-auto">
            {/* Composer */}
            <div className="flex items-center gap-3 px-2 py-2 mb-2 border-b border-border">
              <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={composerRef}
                value={composerValue}
                onChange={(e) => setComposerValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addTask(composerValue, null);
                    setComposerValue('');
                  }
                  if (e.key === 'Escape') {
                    setComposerValue('');
                    composerRef.current?.blur();
                  }
                }}
                placeholder="Add a task"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-1"
              />
            </div>

            {openRows.length === 0 && (
              <div className="py-16 text-center">
                <ListChecks className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Nothing here yet. Add a task above, or press{' '}
                  <kbd className="px-1.5 py-0.5 rounded border border-border bg-secondary text-xs">n</kbd>.
                </p>
              </div>
            )}

            <div className="space-y-0.5">
              {openTree.map((node) => renderRow(node, false))}
            </div>

            {completedRows.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowCompleted((s) => !s)}
                  aria-expanded={showCompleted}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {showCompleted ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Completed ({completedRows.length})
                </button>
                {showCompleted && (
                  <div className="space-y-0.5 mt-1">
                    {completedTree.map((node) => renderRow(node, true))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile compose button, clear of the tab bar and the home indicator */}
      <button
        onClick={() => composerRef.current?.focus()}
        aria-label="Add a task"
        className="md:hidden fixed right-5 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center cursor-pointer"
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Detail panel: side sheet on desktop, bottom sheet on mobile */}
      {selected && (
        <div className="fixed inset-0 z-50 flex md:items-stretch md:justify-end items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedId(null)} />
          <div className="relative w-full md:w-96 md:h-full max-h-[85vh] md:max-h-none overflow-y-auto bg-card border-t md:border-t-0 md:border-l border-border rounded-t-2xl md:rounded-none p-5 pb-8 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-foreground">Task details</h2>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Title</span>
              <input
                key={`title-${selected.id}`}
                defaultValue={selected.title}
                onBlur={(e) => saveTitle(selected.id, e.target.value)}
                className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Notes</span>
              <textarea
                key={`desc-${selected.id}`}
                defaultValue={selected.description ?? ''}
                rows={4}
                onBlur={(e) => {
                  const next = e.target.value.trim() || null;
                  if (next === (selected.description ?? null)) return;
                  patchLocal([selected.id], { description: next });
                  run(() => updateTaskAction(selected.id, { description: next }));
                }}
                className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">List</span>
              <select
                value={selected.boardId}
                onChange={(e) => {
                  const target = Number(e.target.value);
                  setSelectedId(null);
                  run(() => moveTaskToBoardAction(selected.id, target));
                }}
                className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={() => toggleStar(selected)}
              className="flex items-center gap-2 text-sm text-foreground hover:text-amber-400 transition-colors cursor-pointer"
            >
              <Star
                className={`h-4 w-4 ${selected.isStarred ? 'text-amber-400' : ''}`}
                fill={selected.isStarred ? 'currentColor' : 'none'}
              />
              {selected.isStarred ? 'Starred' : 'Add star'}
            </button>

            <div className="pt-2 border-t border-border">
              <button
                onClick={() => {
                  const subs = localRows.filter((r) => r.parentId === selected.id).length;
                  const message = subs
                    ? `Delete “${selected.title}” and its ${subs} subtask${subs === 1 ? '' : 's'}?`
                    : `Delete “${selected.title}”?`;
                  if (window.confirm(message)) removeTask(selected.id);
                }}
                className="flex items-center gap-2 px-3 py-2 -ml-3 rounded text-sm font-medium text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Some subtasks aren't done" confirmation */}
      {confirmParent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmParent(null)} />
          <div className="relative w-full max-w-sm bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
            <h2 className="text-sm font-bold text-foreground">
              {confirmParent.open} subtask{confirmParent.open === 1 ? '' : 's'} still open
            </h2>
            <p className="text-sm text-muted-foreground">
              Completing “{confirmParent.node.title}” will complete{' '}
              {confirmParent.open === 1 ? 'it' : 'them'} too. Close it anyway?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmParent(null)}
                className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
              >
                Keep it open
              </button>
              <button
                onClick={() => {
                  applyCompletion(confirmParent.node, true, true);
                  setConfirmParent(null);
                }}
                className="px-3 py-2 rounded text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
              >
                Complete all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New list prompt */}
      {newBoardOpen && (
        <NewBoardDialog
          onCancel={() => setNewBoardOpen(false)}
          onCreate={(name) => {
            setNewBoardOpen(false);
            run(async () => {
              const id = await createBoardAction(name);
              router.push(`/tasks/${id}`);
            });
          }}
        />
      )}

      {/* Undo toast */}
      {undo && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 z-[70] flex items-center gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-2xl max-w-[calc(100vw-2rem)]"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          <span className="text-sm text-foreground truncate">{undo.message}</span>
          <button
            onClick={undoCompletion}
            className="text-sm font-semibold text-foreground underline underline-offset-2 hover:opacity-80 shrink-0 cursor-pointer"
          >
            Undo
          </button>
          <button
            onClick={dismissUndo}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function NewBoardDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold text-foreground">New list</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onCreate(name);
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="List name"
          className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onCreate(name)}
            disabled={!name.trim()}
            className="px-3 py-2 rounded text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
