'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { usePreservedScroll } from '@/lib/usePreservedScroll';
import { useSwipeNavigation } from '@/lib/useSwipeNavigation';
import {
  Bell,
  BellOff,
  Check,
  CornerDownRight,
  ListChecks,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  flattenTaskTree,
  countOpenDescendants,
  MAX_TASK_DEPTH,
  MAX_VISIBLE_BOARDS,
  REMINDERS_ONLY_COOKIE,
  VISIBLE_BOARDS_COOKIE,
  VIRTUAL_LISTS,
  VIRTUAL_LIST_NAMES,
  VIRTUAL_SORT_COOKIE_PREFIX,
  type NewTaskDetails,
  type SortMode,
  type VirtualList,
  type TaskRow,
  type TaskNode,
} from '@/lib/tasks';
import {
  createTaskAction,
  updateTaskAction,
  toggleTaskCompletionAction,
  setTaskCompletionAction,
  deleteTaskAction,
  restoreTasksAction,
  type TaskSnapshot,
  setTaskStarredAction,
  moveTaskToBoardAction,
  createBoardAction,
  reorderBoardsAction,
  setBoardSortAction,
  moveTaskAction,
  setTaskTagsAction,
  setTaskScheduleAction,
  setTaskRecurrenceAction,
  skipOccurrenceAction,
  postponeOccurrenceAction,
  restoreTaskDeadlineAction,
  setTaskReminderActiveAction,
} from '@/app/task-actions';
import { dateToServerDbString, pacificDbStringToDate } from '@/lib/timezone';
import { formatDue, displayTitle } from '@/lib/taskSchedule';
import { useTaskDrag, type DropTarget } from '@/features/tasks/useTaskDrag';
import Select from '@/app/components/Select';
import { useConfirm, isInsideModal } from '@/app/components/ConfirmDialog';
import { useUndo } from '@/app/components/UndoToast';
import { reminderFired } from '@/features/tasks/reminders';
import { type BoardSummary, type VisibleBoard, type TaskTag, type ColumnHandlers } from '@/features/tasks/types';
import BoardColumn from '@/features/tasks/components/BoardColumn';
import EditTaskDialog from '@/features/tasks/components/EditTaskDialog';
import SchedulePicker from '@/features/tasks/components/SchedulePicker';
import RepeatPicker from '@/features/tasks/components/RepeatPicker';
import TagPicker from '@/features/tasks/components/TagPicker';
import BoardNameDialog from '@/features/tasks/components/BoardNameDialog';

interface TasksClientProps {
  boards: BoardSummary[];
  visibleBoards: VisibleBoard[];
  rows: TaskRow[];
  availableTags: TaskTag[];
  tagsByTask: Record<number, number[]>;
  remindersOnly: boolean;
}

export default function TasksClient({
  boards,
  visibleBoards,
  rows,
  availableTags,
  tagsByTask,
  remindersOnly: initialRemindersOnly,
}: TasksClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { confirm } = useConfirm();

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

  // The rail's order, mirrored locally so a drag rearranges under the pointer
  // rather than after a round trip.
  const [railBoards, setRailBoards] = useState<BoardSummary[]>(boards);
  const [syncedBoards, setSyncedBoards] = useState<BoardSummary[]>(boards);
  if (boards !== syncedBoards) {
    setSyncedBoards(boards);
    setRailBoards(boards);
  }
  const [draggedBoard, setDraggedBoard] = useState<number | null>(null);

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
  const { raiseUndo } = useUndo();
  const [confirmParent, setConfirmParent] = useState<{ node: TaskNode; open: number } | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);

  // Each column's composer, so `n` can aim at the one under the pointer.
  const composers = useRef(new Map<number, HTMLInputElement | null>());

  const registerComposer = useCallback((boardId: number, el: HTMLInputElement | null) => {
    if (el) composers.current.set(boardId, el);
    else composers.current.delete(boardId);
  }, []);

  // A virtual list is shown on its own, so it stands in for the whole visible
  // set — in the cookie too, which /tasks reads straight back as a path.
  const virtual = visibleBoards[0].virtual;
  const visibleIds = virtual ? [] : visibleBoards.map((b) => b.id);
  const primary = visibleBoards[0];

  // Mirror the visible set into a cookie so /tasks can restore it on the
  // server next time. Written from the rendered set rather than from the click
  // handlers, so arriving via a pasted URL or the back button is remembered
  // too. Runs after paint, since nothing on this page reads it back.
  const visibleKey = virtual ?? visibleIds.join(',');

  // A virtual list's sort mode has no task_boards row to live in, so it's held
  // here and mirrored into a cookie for the next server render. Reset when the
  // visible list changes, so switching from All tasks to Starred doesn't carry
  // one list's choice onto the other.
  const [virtualSort, setVirtualSortState] = useState<SortMode | null>(null);
  const [syncedList, setSyncedList] = useState(visibleKey);
  if (visibleKey !== syncedList) {
    setSyncedList(visibleKey);
    setVirtualSortState(null);
  }

  const setVirtualSort = (list: VirtualList, mode: SortMode) => {
    setVirtualSortState(mode);
    document.cookie = `${VIRTUAL_SORT_COOKIE_PREFIX}${list}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
  };

  // Applies to every list, so it lives here and in a cookie rather than per column.
  const [remindersOnly, setRemindersOnlyState] = useState(initialRemindersOnly);
  const setRemindersOnly = (on: boolean) => {
    setRemindersOnlyState(on);
    document.cookie = `${REMINDERS_ONLY_COOKIE}=${on ? 1 : 0}; path=/; max-age=31536000; SameSite=Lax`;
  };

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
  const showList = (kind: VirtualList) => router.push(`/tasks/${kind}`);

  // ----- reordering the rail -----

  const onBoardDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedBoard === null || draggedBoard === index) return;
    const next = [...railBoards];
    const [moved] = next.splice(draggedBoard, 1);
    next.splice(index, 0, moved);
    setRailBoards(next);
    setDraggedBoard(index);
  };

  const onBoardDragEnd = () => {
    setDraggedBoard(null);
    const ids = railBoards.map((b) => b.id);
    // Only worth a write when the drag actually moved something.
    if (ids.join() === boards.map((b) => b.id).join()) return;
    run(() => reorderBoardsAction(ids));
  };

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
      if (isInsideModal(e.target)) return;
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

  // ----- mutations -----

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  };

  const patchLocal = (ids: number[], patch: Partial<TaskRow>) =>
    setLocalRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r)));

  const addTask = (
    boardId: number,
    title: string,
    parentId: number | null,
    details?: NewTaskDetails,
    starred = false
  ) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // A task added from the Starred list has to arrive starred, or it drops
    // out of the list you just added it to.
    run(async () => {
      const id = await createTaskAction(boardId, trimmed, parentId, details);
      if (starred) await setTaskStarredAction(id, true);
    });
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

  const setReminderActive = (row: TaskRow, active: boolean) => {
    patchLocal([row.id], { remindAt: active ? dateToServerDbString(new Date()) : null });
    run(() => setTaskReminderActiveAction(row.id, active));
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
  // ----- mobile paging between lists -----

  // Mobile shows one list at a time, so swiping sideways pages through them in
  // the order the picker offers: the views over everything first, then the
  // boards. No wrap-around — running off either end should feel like the end
  // of the rail, not a jump back to the far side.
  const swipeOrder = useMemo(
    () => [...VIRTUAL_LISTS.map(String), ...boards.map((b) => String(b.id))],
    [boards],
  );

  const pageBy = useCallback(
    (step: number) => {
      // Only the one-column mobile layout pages between lists — a wide screen
      // shows several columns side by side, where a swipe would collapse them
      // down to one. Read at gesture time (the query matches Tailwind's `md`)
      // rather than tracked in state, so it can't go stale behind a resize.
      if (!window.matchMedia('(max-width: 767px)').matches) return;
      const from = swipeOrder.indexOf(String(virtual ?? primary.id));
      const next = swipeOrder[from + step];
      if (from === -1 || next === undefined) return;
      router.push(`/tasks/${next}`);
    },
    [router, swipeOrder, virtual, primary.id],
  );

  const swipeRef = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => pageBy(1),
    onSwipeRight: () => pageBy(-1),
    // Suspended while anything is open over the board, and mid-drag, so a
    // gesture meant for a dialog or a task row can't page the list away.
    enabled:
      selectedId === null &&
      !newBoardOpen &&
      confirmParent === null &&
      drag.activeId === null,
  });

  const removeTask = (id: number) => {
    setSelectedId(null);
    setLocalRows((prev) => prev.filter((r) => r.id !== id && r.parentId !== id));
    run(async () => {
      const snapshot = await deleteTaskAction(id);
      const root = snapshot.tasks.find((t) => t.id === id);
      const subs = snapshot.tasks.length - 1;
      raiseUndo({
        message: `Deleted “${root ? displayTitle(root.title, root.counterValue) : 'task'}”${
          subs > 0 ? ` and ${subs} subtask${subs === 1 ? '' : 's'}` : ''
        }`,
        undo: () => run(() => restoreTasks(snapshot)),
      });
    });
  };

  const restoreTasks = async (snapshot: TaskSnapshot) => {
    const res = await restoreTasksAction(snapshot);
    if (res.error) raiseUndo({ message: `Couldn’t undo: ${res.error.toLowerCase()}`, undo: null });
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
    setVirtualSort,
    remindersOnly,
    setRemindersOnly,
    editingId,
    setEditingId,
    subtaskParent,
    setSubtaskParent,
    selectedId,
  };

  // Switching board remounts the page, which would otherwise send the rail
  // back to the top every time — including on the way to a board far enough
  // down the list to need scrolling to in the first place.
  const boardsRailScrollRef = usePreservedScroll<HTMLDivElement>('tasks:boards-rail');

  return (
    <div ref={swipeRef} className="flex-1 min-h-0 flex overflow-hidden">
      {/* Boards rail. The name shows that board on its own; the checkbox adds
          it beside the others, up to MAX_VISIBLE_BOARDS. */}
      <aside className="hidden md:flex w-44 shrink-0 border-r border-border flex-col">
        <div ref={boardsRailScrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
          {/* Views over every board. They replace the visible set rather than
              joining it: "everything" beside one list would show the same
              tasks twice, and there'd be no honest answer for which copy a
              drag was moving. */}
          {VIRTUAL_LISTS.map((kind) => {
            const shown = virtual === kind;
            return (
              <button
                key={kind}
                onClick={() => showList(kind)}
                aria-current={shown ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  shown
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                {kind === 'starred' ? (
                  <Star className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ListChecks className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{VIRTUAL_LIST_NAMES[kind]}</span>
              </button>
            );
          })}

          <div className="!my-2 border-t border-border" />

          {railBoards.map((b, index) => {
            const shown = visibleIds.includes(b.id);
            const atLimit = !shown && visibleIds.length >= MAX_VISIBLE_BOARDS;
            return (
              <div
                key={b.id}
                draggable
                onDragStart={() => setDraggedBoard(index)}
                onDragOver={(e) => onBoardDragOver(e, index)}
                onDragEnd={onBoardDragEnd}
                className={`flex items-center gap-1 rounded-lg transition-colors ${
                  shown ? 'bg-secondary' : 'hover:bg-secondary/50'
                } ${draggedBoard === index ? 'opacity-50' : ''}`}
              >
                <button
                  onClick={() => showOnly(b.id)}
                  aria-current={shown ? 'page' : undefined}
                  title={b.isDefault ? `Show only ${b.name} (default list)` : `Show only ${b.name}`}
                  className={`flex-1 min-w-0 flex items-center gap-1.5 text-left pl-2.5 pr-1 py-2 text-sm font-medium cursor-pointer ${
                    shown ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="truncate">{b.name}</span>
                  {/* Which list All tasks and Starred add to — worth saying in
                      the rail, since that's where it's chosen. The name gives
                      way to it rather than the other way round. */}
                  {b.isDefault && (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      default
                    </span>
                  )}
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
          <button
            onClick={() => setRemindersOnly(!remindersOnly)}
            role="switch"
            aria-checked={remindersOnly}
            title="Show only open tasks whose reminder has gone off, or that are due ASAP, in every list"
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors cursor-pointer ${
              remindersOnly ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span
              className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
                remindersOnly ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
              }`}
            >
              {remindersOnly && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            </span>
            <span className="text-left leading-tight">Active reminders only</span>
          </button>
        </div>
      </aside>

      {/* Columns. Mobile shows the first board only — see the picker in its header. */}
      <div className="flex-1 min-w-0 flex divide-x divide-border">
        {visibleBoards.map((b) => (
          <BoardColumn
            key={b.virtual ?? b.id}
            board={b.virtual && virtualSort ? { ...b, sortMode: virtualSort } : b}
            boards={boards}
            rows={b.virtual ? localRows : localRows.filter((r) => r.boardId === b.id)}
            availableTags={availableTags}
            collapsed={visibleBoards.length > 1}
            handlers={handlers}
            registerComposer={registerComposer}
            onPickBoard={showOnly}
            onPickList={showList}
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
            <Select
              value={selected.boardId}
              onChange={(target) => {
                setSelectedId(null);
                run(() => moveTaskToBoardAction(selected.id, target));
              }}
              className="w-full rounded bg-secondary border border-border px-2.5 py-2 md:py-1 text-sm md:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              options={boards.map((b) => ({ value: b.id, label: b.name }))}
            />
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

          {/* ASAP tasks always count as reminded, so there's nothing to toggle. */}
          {!selected.completedAt && selected.dueAsap !== 1 && (
            reminderFired(selected) ? (
              <button
                onClick={() => setReminderActive(selected, false)}
                title="Turn the reminder off"
                className="flex items-center gap-2 text-sm md:text-xs text-foreground hover:text-amber-400 transition-colors cursor-pointer"
              >
                <BellOff className="h-3.5 w-3.5" />
                Dismiss reminder
              </button>
            ) : (
              <button
                onClick={() => setReminderActive(selected, true)}
                title="Count this task as reminded from now"
                className="flex items-center gap-2 text-sm md:text-xs text-foreground hover:text-amber-400 transition-colors cursor-pointer"
              >
                <Bell className="h-3.5 w-3.5" />
                Set reminder active
              </button>
            )
          )}

          <div className="pt-2 border-t border-border">
            <button
              onClick={async () => {
                const subs = localRows.filter((r) => r.parentId === selected.id).length;
                const ok = await confirm({
                  title: `Delete “${selected.title}”?`,
                  message: subs
                    ? `Its ${subs} subtask${subs === 1 ? '' : 's'} will be deleted too.`
                    : undefined,
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (ok) removeTask(selected.id);
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
    </div>
  );
}
