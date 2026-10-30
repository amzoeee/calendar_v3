import React from 'react';
import {
  type NewTaskDetails,
  type SortMode,
  type VirtualList,
  type TaskRow,
  type TaskNode,
} from '@/lib/tasks';
import { type DropTarget } from './useTaskDrag';

export interface BoardSummary {
  id: number;
  name: string;
  /** Where All tasks and Starred add a task. Exactly one board carries it. */
  isDefault: boolean;
}

// A column stands for a board or for a view across all of them, so it carries
// no default flag of its own — `boards` is where that lives.
export interface VisibleBoard extends Omit<BoardSummary, 'isDefault'> {
  sortMode: SortMode;
  /** Set when this column is a view across every board, not a board. */
  virtual: VirtualList | null;
  /** For a virtual list, the board its composer writes to, by name. */
  targetName: string | null;
}

export interface TaskTag {
  id: number;
  name: string;
  color: string;
}

// Handlers a column needs from its parent. Bundled rather than passed one by
// one, since every column gets exactly the same set.
export interface ColumnHandlers {
  addTask: (
    boardId: number,
    title: string,
    parentId: number | null,
    details?: NewTaskDetails,
    starred?: boolean
  ) => void;
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
  setVirtualSort: (list: VirtualList, mode: SortMode) => void;
  remindersOnly: boolean;
  setRemindersOnly: (on: boolean) => void;
  tagsFor: (taskId: number) => TaskTag[];
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  subtaskParent: number | null;
  setSubtaskParent: (id: number | null) => void;
  selectedId: number | null;
}
