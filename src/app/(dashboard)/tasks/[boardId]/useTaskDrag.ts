'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { MAX_TASK_DEPTH } from '@/lib/tasks';

// How far the pointer has to travel before a press becomes a drag. Small
// enough to feel immediate, large enough that a click on the handle isn't
// misread as a one-pixel drag.
const DRAG_THRESHOLD = 4;
// Horizontal travel that means "make this a subtask" / "pull it back out".
//
// Two values, because the two pointers have very different precision. A mouse
// goes where you put it. A thumb arcs: dragging a row down a list swings it
// sideways on the way, and at a mouse-sized threshold that reads as a
// deliberate indent every few drags. Touch therefore has to travel roughly
// twice as far before the gesture counts as one.
const INDENT_THRESHOLD_FINE = 36;
const INDENT_THRESHOLD_COARSE = 72;
// Matches the per-level padding the rows render with.
const INDENT_PX = 24;

export interface DropTarget {
  boardId: number;
  parentId: number | null;
  siblingIds: number[];
}

interface RowRect {
  id: number;
  boardId: number;
  parentId: number | null;
  depth: number;
  top: number;
  bottom: number;
}

interface ColumnRect {
  boardId: number;
  left: number;
  right: number;
  top: number;
}

export interface DragIndicator {
  left: number;
  top: number;
  width: number;
}

interface DragSession {
  id: number;
  subtree: Set<number>;
  /** Deepest level below the dragged task, so we can refuse illegal nesting. */
  height: number;
  startX: number;
  startY: number;
  /** Left edge of the column the drag began in — see resolve() on why. */
  startColumnLeft: number;
  /** Chosen from the pointer that started this drag, not from screen size. */
  indentThreshold: number;
  rows: RowRect[];
  columns: ColumnRect[];
}

/**
 * Pointer-driven drag for task rows: reorder within a list, indent into a
 * subtask, or move across the columns on screen.
 *
 * Pointer events rather than HTML5 drag-and-drop, for two reasons: HTML5 DnD
 * doesn't fire on touch at all, and it gives no clean way to read horizontal
 * displacement, which is what distinguishes "reorder" from "indent" here.
 *
 * Geometry is snapshotted once when the drag begins and hit-tested from that
 * snapshot, so moving the pointer never forces a layout. The drop indicator is
 * an absolutely positioned overlay for the same reason — inserting a real
 * placeholder row would reflow the list under the cursor.
 */
export function useTaskDrag({
  onCommit,
  onCancel,
}: {
  onCommit: (id: number, target: DropTarget) => void;
  onCancel?: () => void;
}) {
  const session = useRef<DragSession | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [indicator, setIndicator] = useState<DragIndicator | null>(null);
  const targetRef = useRef<DropTarget | null>(null);

  const reset = useCallback(() => {
    session.current = null;
    targetRef.current = null;
    setActiveId(null);
    setIndicator(null);
  }, []);

  // Read the rendered list straight out of the DOM. The rows already carry
  // everything needed as data attributes, which keeps this hook from needing a
  // parallel copy of the task tree.
  const snapshot = useCallback((): { rows: RowRect[]; columns: ColumnRect[] } => {
    const rows: RowRect[] = [];
    document.querySelectorAll<HTMLElement>('[data-task-row]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.dataset.parentId;
      rows.push({
        id: Number(el.dataset.taskId),
        boardId: Number(el.dataset.boardId),
        parentId: parent === '' || parent == null ? null : Number(parent),
        depth: Number(el.dataset.depth),
        top: rect.top,
        bottom: rect.bottom,
      });
    });

    const columns: ColumnRect[] = [];
    document.querySelectorAll<HTMLElement>('[data-board-column]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      columns.push({
        boardId: Number(el.dataset.boardId),
        left: rect.left,
        right: rect.right,
        top: rect.top,
      });
    });

    rows.sort((a, b) => a.top - b.top);
    return { rows, columns };
  }, []);

  const resolve = useCallback((x: number, y: number) => {
    const s = session.current;
    if (!s) return;

    const column =
      s.columns.find((c) => x >= c.left && x <= c.right) ??
      s.columns.find((c) => c.boardId === s.rows.find((r) => r.id === s.id)?.boardId);
    if (!column) return;

    // Horizontal travel is measured *within the column*, not across the
    // screen. Dragging to a neighbouring column moves the pointer hundreds of
    // pixels sideways, which would otherwise read as a deliberate indent every
    // single time.
    const dx = x - column.left - (s.startX - s.startColumnLeft);

    // A task can't be dropped into its own subtree, so those rows are not
    // candidates for anything.
    const candidates = s.rows.filter(
      (r) => r.boardId === column.boardId && !s.subtree.has(r.id)
    );

    // Insertion point: the first row whose middle sits below the pointer.
    let index = candidates.findIndex((r) => y < (r.top + r.bottom) / 2);
    if (index === -1) index = candidates.length;
    const preceding = candidates[index - 1];

    // Default: land as a sibling of whatever we're following. Horizontal
    // travel then overrides that — right to nest, left to pull back out.
    let parentId: number | null = preceding
      ? preceding.depth > 0
        ? preceding.parentId
        : null
      : null;

    const canNest = s.height === 0 && MAX_TASK_DEPTH >= 1;
    if (dx > s.indentThreshold && preceding && canNest) {
      parentId = preceding.depth === 0 ? preceding.id : preceding.parentId;
    } else if (dx < -s.indentThreshold) {
      parentId = null;
    }

    const targetDepth = parentId == null ? 0 : 1;
    const indicatorY = preceding
      ? preceding.bottom
      : candidates[0]?.top ?? column.top;

    const siblings = candidates.filter((r) => r.parentId === parentId);
    const insertAt = siblings.filter((r) => r.top < indicatorY).length;
    const siblingIds = siblings.map((r) => r.id);
    siblingIds.splice(insertAt, 0, s.id);

    targetRef.current = { boardId: column.boardId, parentId, siblingIds };
    setIndicator({
      left: column.left + 12 + targetDepth * INDENT_PX,
      top: indicatorY,
      width: column.right - column.left - 24 - targetDepth * INDENT_PX,
    });
  }, []);

  useEffect(() => {
    if (activeId == null) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      resolve(e.clientX, e.clientY);
    };
    const onUp = () => {
      const s = session.current;
      const target = targetRef.current;
      if (s && target) onCommit(s.id, target);
      reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onCancel?.();
      reset();
    };

    // A drag that starts near text will otherwise turn into a selection
    // sweep, which looks like the drag silently failing.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('keydown', onKey);
    };
  }, [activeId, resolve, onCommit, onCancel, reset]);

  /**
   * Handlers for a row's drag handle. The press only becomes a drag once the
   * pointer has moved DRAG_THRESHOLD, so a stray click on the handle does
   * nothing rather than committing a zero-distance move.
   */
  const handleProps = useCallback(
    (id: number, subtreeIds: number[], height: number) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const startX = e.clientX;
        const startY = e.clientY;
        const indentThreshold =
          e.pointerType === 'mouse' ? INDENT_THRESHOLD_FINE : INDENT_THRESHOLD_COARSE;

        const begin = (ev: PointerEvent) => {
          if (
            Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
          ) {
            return;
          }
          window.removeEventListener('pointermove', begin);
          const { rows, columns } = snapshot();
          const startColumn = columns.find((c) => startX >= c.left && startX <= c.right);
          session.current = {
            id,
            subtree: new Set(subtreeIds),
            height,
            startX,
            startY,
            startColumnLeft: startColumn?.left ?? 0,
            indentThreshold,
            rows,
            columns,
          };
          setActiveId(id);
          resolve(ev.clientX, ev.clientY);
        };

        const stop = () => {
          window.removeEventListener('pointermove', begin);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', begin);
        window.addEventListener('pointerup', stop);
      },
    }),
    [snapshot, resolve]
  );

  return { activeId, indicator, handleProps, isDragging: activeId != null };
}
