'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  GripVertical,
  ListChecks,
  MoreHorizontal,
  Plus,
  CalendarClock,
  CalendarPlus,
  Repeat,
  SkipForward,
  Star,
  Tag as TagIcon,
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
  MAX_VISIBLE_BOARDS,
  VISIBLE_BOARDS_COOKIE,
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
  moveTaskAction,
  setTaskTagsAction,
  setTaskScheduleAction,
  setTaskRecurrenceAction,
  skipOccurrenceAction,
  postponeOccurrenceAction,
  restoreTaskDeadlineAction,
  createTasksBulkAction,
} from '@/app/task-actions';
import {
  dateToServerDbString,
  pacificDbStringToDate,
  formatDateInputValue,
  formatTimeInputValue,
  shiftDateStr,
} from '@/lib/timezone';
import {
  TIMED_PRESETS,
  DATED_PRESETS,
  DEFAULT_REMIND_TIME,
  dueState,
  formatDue,
  displayTitle,
  repeatLabel,
  postponeLabel,
  REPEAT_OPTIONS,
} from '@/lib/taskSchedule';
import { useTaskDrag, type DropTarget } from './useTaskDrag';
import { clampOverlayX } from '@/lib/overlayPosition';

interface BoardSummary {
  id: number;
  name: string;
}

interface VisibleBoard extends BoardSummary {
  sortMode: SortMode;
}

export interface TaskTag {
  id: number;
  name: string;
  color: string;
}

interface TasksClientProps {
  boards: BoardSummary[];
  visibleBoards: VisibleBoard[];
  rows: TaskRow[];
  availableTags: TaskTag[];
  tagsByTask: Record<number, number[]>;
}

// The Undo toast carries the action that reverses whatever just happened, so
// each raiser decides what "undo" means for it. `undo: null` renders the
// message without a button — better than offering one that does nothing.
interface UndoState {
  message: string;
  undo: (() => void) | null;
}

// Handlers a column needs from its parent. Bundled rather than passed one by
// one, since every column gets exactly the same set.
interface ColumnHandlers {
  addTask: (boardId: number, title: string, parentId: number | null) => void;
  requestCompletion: (node: TaskNode, completed: boolean) => void;
  toggleStar: (row: TaskRow) => void;
  saveTitle: (id: number, title: string) => void;
  openEditor: (id: number, at: { x: number; y: number }) => void;
  moveTask: (id: number, target: DropTarget) => void;
  dragHandleProps: (id: number, subtreeIds: number[], height: number) => {
    onPointerDown: (e: React.PointerEvent) => void;
  };
  draggingId: number | null;
  run: (fn: () => Promise<unknown>) => void;
  tagsFor: (taskId: number) => TaskTag[];
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  subtaskParent: number | null;
  setSubtaskParent: (id: number | null) => void;
  selectedId: number | null;
}

export default function TasksClient({
  boards,
  visibleBoards,
  rows,
  availableTags,
  tagsByTask,
}: TasksClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Server rows are the source of truth; this mirror exists so ticking a box
  // strikes it through immediately instead of after a server round trip. The
  // reset happens during render rather than in an effect — React's documented
  // way to adjust state when props change.
  const [localRows, setLocalRows] = useState<TaskRow[]>(rows);
  const [syncedRows, setSyncedRows] = useState<TaskRow[]>(rows);
  if (rows !== syncedRows) {
    setSyncedRows(rows);
    setLocalRows(rows);
  }

  const [localTags, setLocalTags] = useState<Record<number, number[]>>(tagsByTask);
  const [syncedTags, setSyncedTags] = useState<Record<number, number[]>>(tagsByTask);
  if (tagsByTask !== syncedTags) {
    setSyncedTags(tagsByTask);
    setLocalTags(tagsByTask);
  }

  const tagById = useMemo(
    () => new Map(availableTags.map((t) => [t.id, t])),
    [availableTags]
  );
  const tagsFor = (taskId: number): TaskTag[] =>
    (localTags[taskId] ?? []).map((id) => tagById.get(id)).filter((t): t is TaskTag => !!t);

  const setTags = (taskId: number, tagIds: number[]) => {
    setLocalTags((prev) => ({ ...prev, [taskId]: tagIds }));
    run(() => setTaskTagsAction(taskId, tagIds));
  };

  const [subtaskParent, setSubtaskParent] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The point the edit dialog was opened from — its top-left corner lands
  // here, the way the calendar's event overlay does.
  const [editorAt, setEditorAt] = useState<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [confirmParent, setConfirmParent] = useState<{ node: TaskNode; open: number } | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);

  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each column's composer, so `n` can aim at the one under the pointer.
  const composers = useRef(new Map<number, HTMLInputElement | null>());

  const registerComposer = useCallback((boardId: number, el: HTMLInputElement | null) => {
    if (el) composers.current.set(boardId, el);
    else composers.current.delete(boardId);
  }, []);

  const visibleIds = visibleBoards.map((b) => b.id);
  const primary = visibleBoards[0];

  // Mirror the visible set into a cookie so /tasks can restore it on the
  // server next time. Written from the rendered set rather than from the click
  // handlers, so arriving via a pasted URL or the back button is remembered
  // too. Runs after paint, since nothing on this page reads it back.
  const visibleKey = visibleIds.join(',');
  useEffect(() => {
    document.cookie = `${VISIBLE_BOARDS_COOKIE}=${visibleKey}; path=/; max-age=31536000; SameSite=Lax`;
  }, [visibleKey]);

  /**
   * Focus the composer of whichever column the pointer is over, falling back
   * to the leftmost — with several lists on screen, "add a task" has to mean
   * "to the list I'm looking at". The hovered column is read straight off CSS
   * :hover rather than tracked with a mousemove listener.
   */
  const focusComposer = useCallback(() => {
    const hovered = document.querySelector<HTMLElement>('[data-board-column]:hover');
    const hoveredId = hovered ? Number(hovered.dataset.boardId) : null;
    const target =
      (hoveredId != null ? composers.current.get(hoveredId) : null) ??
      composers.current.get(primary.id);
    target?.focus();
  }, [primary.id]);

  const selected = useMemo(
    () => localRows.find((r) => r.id === selectedId) ?? null,
    [localRows, selectedId]
  );

  // ----- navigation between board selections -----

  const showOnly = (id: number) => router.push(`/tasks/${id}`);

  const toggleColumn = (id: number) => {
    const next = visibleIds.includes(id)
      ? visibleIds.filter((v) => v !== id)
      : [...visibleIds, id].slice(0, MAX_VISIBLE_BOARDS);
    if (next.length === 0) return;
    router.push(`/tasks/${next.join(',')}`);
  };

  // ----- keyboard -----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      focusComposer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusComposer]);

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

  const addTask = (boardId: number, title: string, parentId: number | null) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    run(() => createTaskAction(boardId, trimmed, parentId));
  };

  const applyCompletion = (node: TaskNode, completed: boolean, cascade: boolean) => {
    // Optimistically strike through the whole subtree we're about to send, then
    // reconcile with the ids the server reports it actually changed.
    const optimistic = cascade
      ? flattenTaskTree([node]).filter((n) => Boolean(n.completedAt) !== completed).map((n) => n.id)
      : [node.id];
    patchLocal(optimistic, { completedAt: completed ? dateToServerDbString(new Date()) : null });

    startTransition(async () => {
      const { changed, rolled } = await toggleTaskCompletionAction(node.id, completed, cascade);
      if (changed.length > 0) {
        const name = displayTitle(node.title, node.counterValue);
        raiseUndo({
          message: !completed
            ? `Moved “${name}” back to your list`
            : rolled
              ? // A recurring task didn't stay done, so saying "completed" and
                // leaving it in the list would look like nothing happened.
                `Completed “${name}” — moved to the next one`
              : changed.length > 1
                ? `Completed “${name}” and ${changed.length - 1} subtask${changed.length > 2 ? 's' : ''}`
                : `Completed “${name}”`,
          undo: () => {
            patchLocal(changed, {
              completedAt: completed ? null : dateToServerDbString(new Date()),
            });
            run(() => setTaskCompletionAction(changed, !completed, rolled));
          },
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

  // Manual ordering is the only thing a drag can express, so a board sorted
  // some other way is switched over rather than the drop being refused —
  // refusing is what makes reordering feel broken in most task apps.
  const moveTask = (id: number, target: DropTarget) => {
    const board = visibleBoards.find((b) => b.id === target.boardId);
    const needsManual = board != null && board.sortMode !== 'manual';
    run(async () => {
      if (needsManual) await setBoardSortAction(target.boardId, 'manual');
      await moveTaskAction(id, target);
    });
    if (needsManual && board) {
      const previous = board.sortMode;
      raiseUndo({
        message: `Switched “${board.name}” to My order so it could be reordered`,
        undo: () => run(() => setBoardSortAction(board.id, previous)),
      });
    }
  };

  const drag = useTaskDrag({ onCommit: moveTask });

  /**
   * Push a repeating task's deadline on by one of its own cycles.
   *
   * The editor closes on the way, the same as Skip does: the deadline fields
   * hold a draft read when the dialog opened, so leaving it open would show
   * the old date and write it back on the next edit. The toast says where the
   * task landed, which is what the dialog would otherwise have shown.
   */
  const postponeTask = (row: TaskRow) => {
    setSelectedId(null);
    startTransition(async () => {
      const moved = await postponeOccurrenceAction(row.id);
      if (moved) {
        patchLocal([row.id], { dueDatetime: moved.due });
        const landed = formatDue(
          pacificDbStringToDate(moved.due),
          row.dueHasTime === 1,
          new Date()
        );
        raiseUndo({
          message: `Pushed “${displayTitle(row.title, row.counterValue)}” to ${landed}`,
          undo: () => {
            patchLocal([row.id], { dueDatetime: moved.previousDue });
            run(() => restoreTaskDeadlineAction(row.id, moved.previousDue));
          },
        });
      }
      router.refresh();
    });
  };

  const removeTask = (id: number) => {
    setSelectedId(null);
    setLocalRows((prev) => prev.filter((r) => r.id !== id && r.parentId !== id));
    run(() => deleteTaskAction(id));
  };

  const handlers: ColumnHandlers = {
    addTask,
    requestCompletion,
    toggleStar,
    saveTitle,
    tagsFor,
    openEditor: (id, at) => {
      setEditorAt(at);
      setSelectedId(id);
    },
    moveTask,
    dragHandleProps: drag.handleProps,
    draggingId: drag.activeId,
    run,
    editingId,
    setEditingId,
    subtaskParent,
    setSubtaskParent,
    selectedId,
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Boards rail. The name shows that board on its own; the checkbox adds
          it beside the others, up to MAX_VISIBLE_BOARDS. */}
      <aside className="hidden md:flex w-44 shrink-0 border-r border-border flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
          {boards.map((b) => {
            const shown = visibleIds.includes(b.id);
            const atLimit = !shown && visibleIds.length >= MAX_VISIBLE_BOARDS;
            return (
              <div
                key={b.id}
                className={`flex items-center gap-1 rounded-lg transition-colors ${
                  shown ? 'bg-secondary' : 'hover:bg-secondary/50'
                }`}
              >
                <button
                  onClick={() => showOnly(b.id)}
                  aria-current={shown ? 'page' : undefined}
                  title={`Show only ${b.name}`}
                  className={`flex-1 min-w-0 text-left pl-2.5 pr-1 py-2 text-sm font-medium truncate cursor-pointer ${
                    shown ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {b.name}
                </button>
                <button
                  onClick={() => toggleColumn(b.id)}
                  disabled={atLimit || (shown && visibleIds.length === 1)}
                  aria-pressed={shown}
                  title={
                    atLimit
                      ? `Showing ${MAX_VISIBLE_BOARDS} lists already`
                      : shown
                        ? `Hide ${b.name}`
                        : `Show ${b.name} alongside`
                  }
                  className={`mr-2.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 ${
                    shown
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground hover:border-foreground'
                  }`}
                >
                  {shown && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </button>
              </div>
            );
          })}
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

      {/* Columns. Mobile shows the first board only — see the picker in its header. */}
      <div className="flex-1 min-w-0 flex divide-x divide-border">
        {visibleBoards.map((b) => (
          <BoardColumn
            key={b.id}
            board={b}
            boards={boards}
            rows={localRows.filter((r) => r.boardId === b.id)}
            availableTags={availableTags}
            collapsed={visibleBoards.length > 1}
            handlers={handlers}
            registerComposer={registerComposer}
            onPickBoard={showOnly}
            onNewBoard={() => setNewBoardOpen(true)}
            isPrimary={b.id === primary.id}
          />
        ))}
      </div>

      {/* Drop indicator. An overlay rather than a placeholder row, so showing
          it can't reflow the list the pointer is hit-testing against. */}
      {drag.indicator && (
        <div
          aria-hidden="true"
          className="fixed z-[80] h-0.5 rounded-full bg-primary pointer-events-none"
          style={{
            left: drag.indicator.left,
            top: drag.indicator.top - 1,
            width: drag.indicator.width,
          }}
        />
      )}

      {/* Mobile compose button, clear of the tab bar and the home indicator */}
      <button
        onClick={() => composers.current.get(primary.id)?.focus()}
        aria-label="Add a task"
        className="md:hidden fixed right-5 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center cursor-pointer"
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {selected && (
        <EditTaskDialog at={editorAt} onClose={() => setSelectedId(null)}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base md:text-xs font-bold text-foreground">Edit task</h2>
            <button
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Title</span>
            <input
              key={`title-${selected.id}`}
              defaultValue={selected.title}
              onBlur={(e) => saveTitle(selected.id, e.target.value)}
              className="w-full rounded bg-secondary border border-border px-2.5 py-2 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</span>
            <textarea
              key={`desc-${selected.id}`}
              defaultValue={selected.description ?? ''}
              rows={3}
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if (next === (selected.description ?? null)) return;
                patchLocal([selected.id], { description: next });
                run(() => updateTaskAction(selected.id, { description: next }));
              }}
              className="w-full rounded bg-secondary border border-border px-2.5 py-2 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </label>

          <SchedulePicker
            key={`sched-${selected.id}`}
            task={selected}
            onSave={(input) => run(() => setTaskScheduleAction(selected.id, input))}
          />

          <RepeatPicker
            key={`rep-${selected.id}`}
            task={selected}
            onSave={(rrule, start, end) =>
              run(() => setTaskRecurrenceAction(selected.id, rrule, start, end))
            }
            onSkip={() => {
              setSelectedId(null);
              run(() => skipOccurrenceAction(selected.id));
            }}
            onPostpone={() => postponeTask(selected)}
          />

          <div className="space-y-1">
            <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</span>
            <TagPicker
              all={availableTags}
              selected={localTags[selected.id] ?? []}
              onChange={(ids) => setTags(selected.id, ids)}
            />
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">List</span>
            <select
              value={selected.boardId}
              onChange={(e) => {
                const target = Number(e.target.value);
                setSelectedId(null);
                run(() => moveTaskToBoardAction(selected.id, target));
              }}
              className="w-full rounded bg-secondary border border-border px-2.5 py-2 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          {selected.depth < MAX_TASK_DEPTH && (
            <button
              onClick={() => {
                setSubtaskParent(selected.id);
                setSelectedId(null);
              }}
              className="flex items-center gap-2 text-sm md:text-xs text-foreground hover:opacity-80 transition-opacity cursor-pointer"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              Add subtask
            </button>
          )}

          <button
            onClick={() => toggleStar(selected)}
            className="flex items-center gap-2 text-sm md:text-xs text-foreground hover:text-amber-400 transition-colors cursor-pointer"
          >
            <Star
              className={`h-3.5 w-3.5 ${selected.isStarred ? 'text-amber-400' : ''}`}
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
              className="flex items-center gap-2 px-2.5 py-1.5 -ml-2.5 rounded text-sm md:text-xs font-medium text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-colors cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              Delete task
            </button>
          </div>
        </EditTaskDialog>
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

      {newBoardOpen && (
        <BoardNameDialog
          heading="New list"
          submitLabel="Create"
          onCancel={() => setNewBoardOpen(false)}
          onSubmit={(name) => {
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
          {undo.undo && (
            <button
              onClick={() => {
                undo.undo?.();
                dismissUndo();
              }}
              className="text-sm font-semibold text-foreground underline underline-offset-2 hover:opacity-80 shrink-0 cursor-pointer"
            >
              Undo
            </button>
          )}
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

/**
 * One board's column: its own header, composer, list and Completed section.
 * Everything that can only be true of one task at a time (which row is being
 * renamed, which has the subtask composer open) lives in the parent; state
 * that is genuinely per-column lives here.
 */
function BoardColumn({
  board,
  boards,
  rows,
  availableTags,
  handlers,
  collapsed,
  registerComposer,
  onPickBoard,
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
  onNewBoard: () => void;
  isPrimary: boolean;
}) {
  const [composerValue, setComposerValue] = useState('');
  const [subtaskValue, setSubtaskValue] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [filterTagIds, setFilterTagIds] = useState<number[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);

  const { subtaskParent, setSubtaskParent, editingId, setEditingId } = handlers;

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

  const activeFilters = filterTagIds.length + (starredOnly ? 1 : 0);

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
   */
  const visibleRows = useMemo(() => {
    if (activeFilters === 0) return rows;

    const matches = (r: TaskRow) => {
      if (starredOnly && !r.isStarred) return false;
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
  }, [rows, filterTagIds, starredOnly, activeFilters]);

  const { openTree, completedTree } = useMemo(() => {
    const open = visibleRows.filter((r) => !r.completedAt);
    const done = visibleRows.filter((r) => r.completedAt);
    return {
      openTree: sortTaskTree(buildTaskTree(open), board.sortMode),
      // Most recently finished first, regardless of the board's sort — the
      // completed pile reads as a log, not as a list you're working through.
      completedTree: sortTaskTree(buildTaskTree(done), 'manual').sort((a, b) =>
        (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
      ),
    };
  }, [visibleRows, board.sortMode]);

  const openCount = useMemo(() => flattenTaskTree(openTree).length, [openTree]);
  const completedRows = useMemo(() => flattenTaskTree(completedTree), [completedTree]);

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

  // `level` is the row's position in the tree being rendered, which is not
  // always node.depth: buildTaskTree promotes a row whose parent isn't in the
  // list to the top level, and such a row has to render flush rather than
  // indented under nothing.
  const renderRow = (node: TaskNode, done: boolean, level = 0) => {
    const isEditing = editingId === node.id;
    const indent = level * 24;
    const descendants = flattenTaskTree([node]);
    const subtreeIds = descendants.map((n) => n.id);
    // Deepest level below this task: a parent can't be nested, a leaf can.
    const height = Math.max(...descendants.map((n) => n.depth)) - node.depth;
    const dragging = handlers.draggingId != null && subtreeIds.includes(handlers.draggingId);
    const rowTags = handlers.tagsFor(node.id);

    return (
      <div key={node.id}>
        <div
          data-task-row
          data-task-id={node.id}
          data-board-id={board.id}
          data-parent-id={node.parentId ?? ''}
          data-depth={node.depth}
          className={`group/row flex items-start gap-1.5 rounded-lg pr-1 py-2 transition-colors ${
            handlers.selectedId === node.id ? 'bg-secondary' : 'hover:bg-secondary/50'
          } ${dragging ? 'opacity-40' : ''}`}
          style={{ paddingLeft: 2 + indent }}
        >
          <button
            {...handlers.dragHandleProps(node.id, subtreeIds, height)}
            aria-label={`Reorder “${node.title}”`}
            title="Drag to reorder, or right to make it a subtask"
            className="mt-0.5 shrink-0 text-muted-foreground/30 hover:text-foreground transition-colors cursor-grab active:cursor-grabbing touch-none p-0.5"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => handlers.requestCompletion(node, !done)}
            aria-label={
              done
                ? `Mark “${displayTitle(node.title, node.counterValue)}” not done`
                : `Mark “${displayTitle(node.title, node.counterValue)}” done`
            }
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
              <EditableTitle
                initial={node.title}
                onCommit={(value) => handlers.saveTitle(node.id, value)}
                onCancel={() => setEditingId(null)}
                onMove={(action) => keyboardMove(node, action)}
              />
            ) : (
              <button
                onClick={() => setEditingId(node.id)}
                className={`block w-full text-left text-sm cursor-text break-words ${
                  done ? 'line-through text-muted-foreground' : 'text-foreground'
                }`}
              >
                {displayTitle(node.title, node.counterValue)}
              </button>
            )}
            {node.description && !isEditing && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{node.description}</p>
            )}
            {(node.dueDatetime || node.rrule || rowTags.length > 0) && (
              /* gap-x/gap-y separately: a single `gap` on a wrapping flex
                 applies to both axes, so the deadline wrapping above the tags
                 opened a full row-gap between them. The top margin lives here
                 rather than on the chips, so a task with neither doesn't carry
                 an empty strip. */
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">
                <DueChip due={node.dueDatetime} hasTime={node.dueHasTime === 1} done={done} />
                {node.rrule && (
                  <span
                    title={repeatLabel(node.rrule) ?? undefined}
                    className="flex items-center gap-1 text-[10px] leading-none text-muted-foreground shrink-0"
                  >
                    <Repeat className="h-2.5 w-2.5" />
                    {repeatLabel(node.rrule)}
                  </span>
                )}
                <TagChips tags={rowTags} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {node.depth < MAX_TASK_DEPTH && !done && (
              <button
                onClick={() => {
                  setSubtaskParent(node.id);
                  setSubtaskValue('');
                }}
                aria-label={`Add a subtask to “${node.title}”`}
                title="Add subtask"
                className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer p-1"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => handlers.toggleStar(node)}
              aria-label={node.isStarred ? `Unstar “${node.title}”` : `Star “${node.title}”`}
              aria-pressed={node.isStarred === 1}
              className={`p-1 transition-colors cursor-pointer ${
                node.isStarred ? 'text-amber-400' : 'text-muted-foreground/60 hover:text-foreground'
              }`}
            >
              <Star className="h-3.5 w-3.5" fill={node.isStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={(e) => {
                // A keyboard-activated click reports 0,0 — fall back to the
                // button itself so the dialog doesn't fly to the corner.
                const r = e.currentTarget.getBoundingClientRect();
                handlers.openEditor(
                  node.id,
                  e.detail === 0 ? { x: r.left, y: r.top } : { x: e.clientX, y: e.clientY }
                );
              }}
              aria-label={`Edit “${node.title}”`}
              className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer p-1"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {subtaskParent === node.id && (
          <div className="flex items-center gap-2.5 py-1" style={{ paddingLeft: 22 + indent + 24 }}>
            <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={subtaskRef}
              value={subtaskValue}
              onChange={(e) => setSubtaskValue(e.target.value)}
              onBlur={() => {
                handlers.addTask(board.id, subtaskValue, node.id);
                setSubtaskParent(null);
                setSubtaskValue('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlers.addTask(board.id, subtaskValue, node.id);
                  setSubtaskValue('');
                }
                if (e.key === 'Escape') setSubtaskParent(null);
              }}
              placeholder="Subtask"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none border-b border-border focus:border-foreground py-1"
            />
          </div>
        )}

        {node.children.map((child) =>
          renderRow(child, Boolean(child.completedAt), level + 1)
        )}
      </div>
    );
  };

  const hasFilterables = tagsInUse.length > 0 || starredOnly || rows.some((r) => r.isStarred);

  // Sort and filter are rendered either as their own header controls or as
  // sections of the overflow menu, depending on how much room the column has.
  // Defined once here so the two placements can't drift apart.
  const checkbox = (on: boolean) => (
    <span
      className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
        on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
      }`}
    >
      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );

  const filterOptions = (
    <>
      <button
        onClick={() => setStarredOnly((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
      >
        {checkbox(starredOnly)}
        <Star className="h-3.5 w-3.5 text-amber-400" fill="currentColor" />
        Starred
      </button>

      {tagsInUse.map((t) => {
        const on = filterTagIds.includes(t.id);
        return (
          <button
            key={t.id}
            onClick={() =>
              setFilterTagIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))
            }
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
          >
            {checkbox(on)}
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            <span className="truncate">{t.name}</span>
          </button>
        );
      })}

      {activeFilters > 0 && (
        <button
          onClick={() => {
            setFilterTagIds([]);
            setStarredOnly(false);
          }}
          className="w-full text-left px-2 py-1.5 text-sm rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
        >
          Clear filters
        </button>
      )}
    </>
  );

  const sortOptions = (
    <>
      {ACTIVE_SORT_MODES.map((mode) => (
        <button
          key={mode}
          onClick={() => {
            setMenuOpen(false);
            handlers.run(() => setBoardSortAction(board.id, mode));
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
          <select
            value={board.id}
            onChange={(e) => {
              if (e.target.value === 'new') onNewBoard();
              else onPickBoard(Number(e.target.value));
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

        <h2 className="hidden md:block flex-1 min-w-0 truncate text-base font-bold text-foreground">
          {board.name}
          {openCount > 0 && (
            <span className="ml-2 text-xs font-medium text-muted-foreground">{openCount}</span>
          )}
        </h2>

        {!collapsed && hasFilterables && (
          <div className="relative shrink-0">
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
          <select
            value={board.sortMode}
            onChange={(e) => handlers.run(() => setBoardSortAction(board.id, e.target.value))}
            aria-label={`Sort ${board.name}`}
            className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[7.5rem]"
          >
            {ACTIVE_SORT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        )}

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
                    {hasFilterables && (
                      <>
                        <div className="my-1 border-t border-border" />
                        {sectionLabel('Filter')}
                        {filterOptions}
                      </>
                    )}
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
                    if (completedRows.length === 0) return;
                    if (
                      window.confirm(
                        `Delete ${completedRows.length} completed task${completedRows.length === 1 ? '' : 's'} from “${board.name}”? Your stats keep the history.`
                      )
                    ) {
                      handlers.run(() => deleteCompletedTasksAction(board.id));
                    }
                  }}
                  disabled={completedRows.length === 0}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Delete completed
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (boards.length <= 1) {
                      window.alert('This is your only list, so it can’t be deleted.');
                      return;
                    }
                    const others = boards.filter((b) => b.id !== board.id);
                    const keep =
                      rows.length === 0 ||
                      window.confirm(
                        `“${board.name}” has ${rows.length} task${rows.length === 1 ? '' : 's'}.\n\nOK: move them to “${others[0].name}”.\nCancel: delete them with the list.`
                      );
                    handlers.run(async () => {
                      await deleteBoardAction(board.id, keep ? others[0].id : null);
                    });
                    onPickBoard(others[0].id);
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

      <div className="flex-1 min-h-0 overflow-y-auto px-2 md:px-3 pt-1 pb-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-1.5 border-b border-border">
          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={(el) => {
              inputRef.current = el;
              registerComposer(board.id, el);
            }}
            value={composerValue}
            onChange={(e) => setComposerValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handlers.addTask(board.id, composerValue, null);
                setComposerValue('');
              }
              if (e.key === 'Escape') {
                setComposerValue('');
                inputRef.current?.blur();
              }
            }}
            placeholder="Add a task"
            className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-1"
          />
        </div>

        {openTree.length === 0 && (
          <div className="py-12 text-center px-3">
            <ListChecks className="h-7 w-7 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-xs text-muted-foreground">
              {activeFilters > 0
                ? 'No tasks match the filter.'
                : 'Nothing here yet. Add a task above'}
              {activeFilters === 0 && isPrimary && (
                <>
                  , or press{' '}
                  <kbd className="px-1.5 py-0.5 rounded border border-border bg-secondary">n</kbd>
                </>
              )}
              {activeFilters === 0 && '.'}
            </p>
          </div>
        )}

        <div className="space-y-0.5">{openTree.map((node) => renderRow(node, false))}</div>

        {completedRows.length > 0 && (
          <div className="mt-5">
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
  );
}

/**
 * Inline rename field. Holds its own draft so that typing in one row can't
 * re-render every other row in the column.
 */
function EditableTitle({
  initial,
  onCommit,
  onCancel,
  onMove,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onMove: (action: 'up' | 'down' | 'indent' | 'outdent') => void;
}) {
  const [value, setValue] = useState(initial);

  // Renaming is where a row already has focus, so it's where the keyboard
  // equivalents of the drag gestures live. Each one saves the name first, so
  // the move can't strand a half-typed edit.
  const move = (action: 'up' | 'down' | 'indent' | 'outdent') => {
    onCommit(value);
    onMove(action);
  };

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          move(e.shiftKey ? 'outdent' : 'indent');
        }
        if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          move(e.key === 'ArrowUp' ? 'up' : 'down');
        }
      }}
      className="w-full bg-transparent border-b border-border text-sm text-foreground focus:outline-none focus:border-foreground py-0.5"
    />
  );
}

/**
 * The edit dialog, in two shapes.
 *
 * On a pointer-sized screen it's a popover whose top-left corner lands on the
 * point you clicked — the same gesture the calendar's event overlay uses, and
 * it shares clampOverlayX with it so the horizontal edge behaviour is
 * literally the same code. Anchoring to the pointer matters more with three
 * columns on screen: a card that jumps to the middle of the window loses which
 * list it belongs to.
 *
 * On a phone there's no cursor to stem from and no room to float, so it
 * becomes a bottom sheet, matching the event editor on the daily view.
 *
 * The shape is chosen from a media query rather than by rendering both and
 * hiding one: the fields are uncontrolled (defaultValue plus onBlur), so a
 * second copy would quietly hold a stale draft.
 */
function EditTaskDialog({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number } | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Matches Tailwind's `md`. Safe to default to the popover: this component
  // only ever mounts after a click, so it never server-renders.
  const [isWide, setIsWide] = useState(true);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isWide) return;

    const MARGIN = 10;
    const { width, height } = el.getBoundingClientRect();

    if (!at) {
      setPos({
        left: Math.max(MARGIN, (window.innerWidth - width) / 2),
        top: Math.max(MARGIN, (window.innerHeight - height) / 2),
      });
      return;
    }

    const left = clampOverlayX(at.x, window.innerWidth, width);
    // Same idea vertically: keep the corner on the click unless that would
    // push the card off the bottom, then lift it just enough to fit.
    const top = Math.max(MARGIN, Math.min(at.y, window.innerHeight - height - MARGIN));

    setPos({ left, top });
  }, [at, isWide]);

  if (!isWide) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
        <div
          role="dialog"
          aria-label="Edit task"
          className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-4"
        >
          <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
          {children}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-label="Edit task"
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          // Hidden for the single frame between mount and measurement.
          visibility: pos ? 'visible' : 'hidden',
        }}
        className="fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] max-h-[65vh] overflow-y-auto bg-card border border-border rounded-xl shadow-2xl p-3.5 space-y-3"
      >
        {children}
      </div>
    </>
  );
}

/**
 * A task's deadline, said the way a person would: the time alone when it's
 * today, a weekday inside the coming week, a date beyond that. Colour carries
 * urgency so a list can be scanned without reading every date, and a completed
 * task drops back to grey — a finished task being "overdue" is noise.
 */
function DueChip({
  due,
  hasTime,
  done,
}: {
  due: string | null;
  hasTime: boolean;
  done: boolean;
}) {
  if (!due) return null;

  const now = new Date();
  const dueDate = pacificDbStringToDate(due);
  const state = done ? 'later' : dueState(formatDateInputValue(dueDate), formatDateInputValue(now));

  const tone = done
    ? 'text-muted-foreground'
    : state === 'overdue'
      ? 'text-red-400'
      : state === 'today'
        ? 'text-amber-400'
        : 'text-muted-foreground';

  return (
    <span className={`flex items-center gap-1 text-[10px] leading-none shrink-0 ${tone}`}>
      <CalendarClock className="h-2.5 w-2.5" />
      {formatDue(dueDate, hasTime, now)}
    </span>
  );
}

/**
 * Deadline and reminder for one task.
 *
 * The reminder is stored as an offset, not a fixed moment, so that it follows
 * the deadline when the deadline moves — which is the whole reason recurring
 * tasks will be able to carry one. The offset comes in two shapes because
 * deadlines do: minutes before a deadline that names a time, whole days plus a
 * time of day for one that names only a date.
 *
 * The preview underneath is computed here in the viewer's own terms rather
 * than read back from the server, so it updates as the fields change. It
 * mirrors the same two rules the server uses.
 */
function SchedulePicker({
  task,
  onSave,
}: {
  task: TaskRow;
  onSave: (input: {
    dueDate: string | null;
    dueTime: string | null;
    remindOffsetMinutes: number | null;
    remindOffsetDays: number | null;
    remindTimeOfDay: string | null;
  }) => void;
}) {
  const initialDue = task.dueDatetime ? pacificDbStringToDate(task.dueDatetime) : null;
  const [dueDate, setDueDate] = useState(initialDue ? formatDateInputValue(initialDue) : '');
  const [dueTime, setDueTime] = useState(
    initialDue && task.dueHasTime ? formatTimeInputValue(initialDue) : ''
  );
  const [minutes, setMinutes] = useState<number | null>(task.remindOffsetMinutes ?? null);
  const [days, setDays] = useState<number | null>(task.remindOffsetDays ?? null);
  const [remindTime, setRemindTime] = useState(task.remindTimeOfDay ?? DEFAULT_REMIND_TIME);

  const commit = (next: Partial<{
    dueDate: string;
    dueTime: string;
    minutes: number | null;
    days: number | null;
    remindTime: string;
  }>) => {
    const d = next.dueDate ?? dueDate;
    const t = next.dueTime ?? dueTime;
    const m = next.minutes !== undefined ? next.minutes : minutes;
    const dy = next.days !== undefined ? next.days : days;
    const rt = next.remindTime ?? remindTime;

    onSave({
      dueDate: d || null,
      dueTime: t || null,
      // Only the shape matching the deadline is sent; the other stays null so
      // computeRemindAt can't be handed both and have to guess.
      remindOffsetMinutes: d && t ? m : null,
      remindOffsetDays: d && !t ? dy : null,
      remindTimeOfDay: d && !t && dy != null ? rt : null,
    });
  };

  // What will actually happen, in the viewer's own timezone.
  let preview: string | null = null;
  if (dueDate && dueTime && minutes != null) {
    const at = new Date(`${dueDate}T${dueTime}`);
    at.setMinutes(at.getMinutes() - minutes);
    preview = at.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } else if (dueDate && !dueTime && days != null) {
    const at = new Date(`${shiftDateStr(dueDate, -days)}T${remindTime}`);
    preview = at.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const field =
    'rounded bg-secondary border border-border px-2 py-1.5 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Deadline
        </span>
        <div className="flex gap-1.5">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              commit({ dueDate: e.target.value });
            }}
            className={`${field} flex-1 min-w-0 cursor-pointer`}
          />
          <input
            type="time"
            value={dueTime}
            disabled={!dueDate}
            onChange={(e) => {
              setDueTime(e.target.value);
              commit({ dueTime: e.target.value });
            }}
            className={`${field} w-[6.25rem] cursor-pointer disabled:opacity-40`}
          />
        </div>
        {dueDate && !dueTime && (
          <p className="text-[10px] text-muted-foreground">Due any time that day.</p>
        )}
      </div>

      {dueDate && (
        <div className="space-y-1">
          <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Reminder
          </span>
          <div className="flex gap-1.5">
            <select
              value={dueTime ? (minutes ?? '') : (days ?? '')}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                if (dueTime) {
                  setMinutes(v);
                  commit({ minutes: v });
                } else {
                  setDays(v);
                  commit({ days: v });
                }
              }}
              className={`${field} flex-1 min-w-0 cursor-pointer`}
            >
              <option value="">No reminder</option>
              {(dueTime ? TIMED_PRESETS : DATED_PRESETS).map((p) => (
                <option key={p.label} value={dueTime ? p.minutes : p.days}>
                  {p.label}
                </option>
              ))}
            </select>
            {!dueTime && days != null && (
              <input
                type="time"
                value={remindTime}
                onChange={(e) => {
                  setRemindTime(e.target.value);
                  commit({ remindTime: e.target.value });
                }}
                className={`${field} w-[6.25rem] cursor-pointer`}
              />
            )}
          </div>
          {preview && <p className="text-[10px] text-muted-foreground">Reminds {preview}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Repeat rule and optional numbering for one task.
 *
 * Recurrence here is rolling — the row advances rather than a run of rows
 * being generated up front — so this edits the single task rather than a
 * series, and there's no "this one or all of them?" to ask.
 *
 * A repeat needs a deadline to advance from, so the control stays disabled
 * until there is one.
 */
function RepeatPicker({
  task,
  onSave,
  onSkip,
  onPostpone,
}: {
  task: TaskRow;
  onSave: (rrule: string | null, start: number | null, end: number | null) => void;
  onSkip: () => void;
  onPostpone: () => void;
}) {
  const [rrule, setRrule] = useState<string | null>(task.rrule);
  const [start, setStart] = useState<string>(
    task.counterValue == null ? '' : String(task.counterValue)
  );
  const [end, setEnd] = useState<string>(task.counterEnd == null ? '' : String(task.counterEnd));

  const hasDeadline = Boolean(task.dueDatetime);
  const numbered = task.title.includes('{n}');

  const field =
    'rounded bg-secondary border border-border px-2 py-1.5 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  const commit = (next: { rrule?: string | null; start?: string; end?: string }) => {
    const r = next.rrule !== undefined ? next.rrule : rrule;
    const st = next.start ?? start;
    const en = next.end ?? end;
    onSave(r, st === '' ? null : Number(st), en === '' ? null : Number(en));
  };

  return (
    <div className="space-y-1">
      <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Repeat
      </span>
      <select
        value={rrule ?? ''}
        disabled={!hasDeadline}
        onChange={(e) => {
          const v = e.target.value || null;
          setRrule(v);
          commit({ rrule: v });
        }}
        className={`${field} w-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {REPEAT_OPTIONS.map((o) => (
          <option key={o.label} value={o.rrule ?? ''}>
            {o.label}
          </option>
        ))}
      </select>

      {!hasDeadline && (
        <p className="text-[10px] text-muted-foreground">Set a deadline first.</p>
      )}

      {rrule && (
        <>
          {numbered ? (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground shrink-0">
                <code>{'{n}'}</code> from
              </span>
              <input
                type="number"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  commit({ start: e.target.value });
                }}
                className={`${field} w-14`}
              />
              <span className="text-[10px] text-muted-foreground shrink-0">to</span>
              <input
                type="number"
                value={end}
                placeholder="∞"
                onChange={(e) => {
                  setEnd(e.target.value);
                  commit({ end: e.target.value });
                }}
                className={`${field} w-14`}
              />
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Put <code>{'{n}'}</code> in the title to number each one.
            </p>
          )}

          {/* Postpone and skip sit together because the difference between
              them is the thing worth seeing: postponing keeps this
              occurrence and moves it, skipping gives up on it and counts it
              as gone. The postpone label names the step it will take. */}
          {postponeLabel(rrule) && (
            <button
              onClick={onPostpone}
              title="Push the deadline on by one cycle, keeping this one"
              className="flex items-center gap-2 pt-1 text-sm md:text-xs text-foreground hover:opacity-80 transition-opacity cursor-pointer"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              {postponeLabel(rrule)}
            </button>
          )}

          <button
            onClick={onSkip}
            title="Give up on this one and move to the next"
            className="flex items-center gap-2 pt-1 text-sm md:text-xs text-foreground hover:opacity-80 transition-opacity cursor-pointer"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip this one
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A row's tags. Two chips at most before collapsing to a count — a task with
 * five tags shouldn't push its own title out of the row.
 *
 * Names are shown at every width. They used to be hidden below `sm`, on the
 * reasoning that a phone is narrow — which had it backwards: a phone shows one
 * list across the full window, so it has *more* room per column than three
 * lists side by side on a desktop. Long names truncate instead.
 */
function TagChips({ tags }: { tags: TaskTag[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {shown.map((t) => (
        <span key={t.id} className="flex items-center gap-1 min-w-0">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: t.color }}
            title={t.name}
          />
          <span className="text-[10px] leading-none text-muted-foreground truncate max-w-[8rem]">
            {t.name}
          </span>
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] leading-none text-muted-foreground shrink-0">+{extra}</span>
      )}
    </div>
  );
}

/**
 * Tag picker for the edit dialog. A searchable list rather than a chip row:
 * event tags and task tags share one set, so this can easily be twenty
 * entries, and twenty chips is a wall.
 */
function TagPicker({
  all,
  selected,
  onChange,
}: {
  all: TaskTag[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = all.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  if (all.length === 0) {
    return <p className="text-xs text-muted-foreground">No tags yet — add some in Settings.</p>;
  }

  return (
    <div className="space-y-2">
      {all.length > 6 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tag"
          className="w-full rounded bg-secondary border border-border px-2 py-1.5 md:py-1 text-xs md:text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      <div className="max-h-44 md:max-h-28 overflow-y-auto rounded border border-border">
        {matches.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">No tag matches “{query}”.</p>
        )}
        {matches.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button
              key={t.id}
              onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              className="w-full flex items-center gap-2 px-2 py-1.5 md:py-1 text-sm md:text-xs hover:bg-secondary transition-colors cursor-pointer"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                  on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
                }`}
              >
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="truncate">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Naming a list, whether it's new or being renamed. Replaces window.prompt,
 * which can't be styled, ignores the app's theme, and on some browsers is
 * suppressed outright.
 */
/**
 * Bulk entry from a pasted list.
 *
 * One task per line; a line indented with a tab or two spaces becomes a
 * subtask of the line above it. Deadlines come from a control rather than from
 * syntax in the text — pasting twelve assignment titles and saying "weekly
 * from Sep 3" is the case this exists for, and it needs no parser to get
 * wrong. Per-line dates wait for the inline-syntax work.
 *
 * The preview is the point: it shows exactly what will be created, including
 * the dates it worked out, before anything is written.
 */
function PasteListDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (items: { title: string; depth: number; dueDate: string | null }[]) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'none' | 'same' | 'series'>('none');
  const [startDate, setStartDate] = useState(formatDateInputValue(new Date()));
  const [everyDays, setEveryDays] = useState('7');

  const parsed = useMemo(() => {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const out: { title: string; depth: number; dueDate: string | null }[] = [];
    const step = Number(everyDays) || 1;

    for (const line of lines) {
      const depth = /^(\t| {2,})/.test(line) ? 1 : 0;

      // Only top-level items get dates; a subtask is a step of its parent, not
      // a separate thing with its own deadline. `out.length` minus the
      // subtasks already emitted gives this item's position in the series.
      let dueDate: string | null = null;
      if (depth === 0 && startDate) {
        if (mode === 'same') dueDate = startDate;
        else if (mode === 'series') {
          const position = out.filter((o) => o.depth === 0).length;
          dueDate = shiftDateStr(startDate, position * step);
        }
      }

      out.push({ title: line.trim(), depth, dueDate });
    }
    return out;
  }, [text, mode, startDate, everyDays]);

  const field =
    'rounded bg-secondary border border-border px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
        <div>
          <h2 className="text-sm font-bold text-foreground">Paste a list</h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            One task per line. Indent a line to make it a subtask.
          </p>
        </div>

        <textarea
          autoFocus
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Read ch. 4\n  take notes\n  practice problems\nEssay outline'}
          className={`${field} w-full resize-y font-mono`}
        />

        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deadlines
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className={`${field} cursor-pointer`}
            >
              <option value="none">No deadlines</option>
              <option value="same">Same date for all</option>
              <option value="series">Spread out, starting…</option>
            </select>
            {mode !== 'none' && (
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${field} cursor-pointer`}
              />
            )}
            {mode === 'series' && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                every
                <input
                  type="number"
                  min={1}
                  value={everyDays}
                  onChange={(e) => setEveryDays(e.target.value)}
                  className={`${field} w-14`}
                />
                days
              </span>
            )}
          </div>
        </div>

        {parsed.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview — {parsed.length} task{parsed.length === 1 ? '' : 's'}
            </span>
            <div className="max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
              {parsed.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
                  style={{ paddingLeft: 8 + item.depth * 18 }}
                >
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.dueDate && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {item.dueDate}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => parsed.length > 0 && onCreate(parsed)}
            disabled={parsed.length === 0}
            className="px-3 py-2 rounded text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create {parsed.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardNameDialog({
  heading,
  initialValue = '',
  submitLabel,
  onCancel,
  onSubmit,
}: {
  heading: string;
  initialValue?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialValue);
  const trimmed = name.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold text-foreground">{heading}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onSubmit(trimmed);
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
            }
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
            onClick={() => trimmed && onSubmit(trimmed)}
            disabled={!trimmed}
            className="px-3 py-2 rounded text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
