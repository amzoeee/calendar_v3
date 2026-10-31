'use client';

import {
  Bell,
  Check,
  CornerDownRight,
  GripVertical,
  MoreHorizontal,
  Repeat,
  Star,
} from 'lucide-react';
import { flattenTaskTree, MAX_TASK_DEPTH, type TaskNode } from '@/lib/tasks';
import { displayTitle, repeatLabel } from '@/lib/taskSchedule';
import { reminderFired } from '../reminders';
import { type ColumnHandlers } from '../types';
import EditableTitle from './EditableTitle';
import DueChip from './DueChip';
import TagChips from './TagChips';

/**
 * One task's row in a column, without its subtasks.
 *
 * `level` is the row's position in the list being rendered, which is not
 * always node.depth: buildTaskTree promotes a row whose parent isn't in the
 * list to the top level, and a flat sort draws every row flush.
 *
 * The `data-depth`/`data-parent-id` a row carries follow `level` for the same
 * reason: a drag resolves its drop against the rows the viewer can see, and
 * under a flat sort every one of those looks top level.
 */
export default function TaskItem({
  node,
  done,
  level,
  virtual,
  boardName,
  parentTitle,
  handlers,
  onMove,
  onAddSubtask,
}: {
  node: TaskNode;
  done: boolean;
  level: number;
  /** Drawn in a view across every board rather than on its own board. */
  virtual: boolean;
  /** The board it belongs to, named only in a virtual list. */
  boardName: string | undefined;
  /** Set when the row is drawn flush but has a parent elsewhere in the list. */
  parentTitle: string | undefined;
  handlers: ColumnHandlers;
  onMove: ((action: 'up' | 'down' | 'indent' | 'outdent') => void) | undefined;
  onAddSubtask: () => void;
}) {
  const { editingId, setEditingId } = handlers;
  const isEditing = editingId === node.id;
  const indent = level * 24;
  const descendants = flattenTaskTree([node]);
  const subtreeIds = descendants.map((n) => n.id);
  // Deepest level below this task: a parent can't be nested, a leaf can.
  const height = Math.max(...descendants.map((n) => n.depth)) - node.depth;
  const dragging = handlers.draggingId != null && subtreeIds.includes(handlers.draggingId);
  const rowTags = handlers.tagsFor(node.id);

  return (
    <div
      data-task-row
      data-task-id={node.id}
      data-board-id={node.boardId}
      data-parent-id={level > 0 ? node.parentId ?? '' : ''}
      data-depth={level}
      className={`group/row flex items-start gap-1.5 rounded-lg pr-1 py-2 transition-colors ${
        handlers.selectedId === node.id ? 'bg-secondary' : 'hover:bg-secondary/50'
      } ${dragging ? 'opacity-40' : ''}`}
      style={{ paddingLeft: 2 + indent }}
    >
      {/* No handle on a virtual list: manual order is per board and per
          parent, so there's no order across boards for a drag to express.
          The space is kept so rows line up the same everywhere. */}
      {virtual ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0 w-[18px]" />
      ) : (
        <button
          {...handlers.dragHandleProps(node.id, subtreeIds, height)}
          aria-label={`Reorder “${node.title}”`}
          title="Drag to reorder, or right to make it a subtask"
          className="mt-0.5 shrink-0 text-muted-foreground/30 hover:text-foreground transition-colors cursor-grab active:cursor-grabbing touch-none p-0.5"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

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
        {parentTitle && (
          <span className="block text-[11px] leading-tight text-muted-foreground/60 truncate">
            {parentTitle}
          </span>
        )}
        {isEditing ? (
          <EditableTitle
            initial={node.title}
            onCommit={(value) => handlers.saveTitle(node.id, value)}
            onCancel={() => setEditingId(null)}
            onMove={onMove}
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
        {(virtual || node.dueDatetime || node.dueAsap === 1 || node.rrule || rowTags.length > 0 || reminderFired(node)) && (
          /* gap-x/gap-y separately: a single `gap` on a wrapping flex
             applies to both axes, so the deadline wrapping above the tags
             opened a full row-gap between them. The top margin lives here
             rather than on the chips, so a task with neither doesn't carry
             an empty strip. */
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">
            {virtual && (
              <span className="text-[10px] leading-none text-muted-foreground/70 shrink-0 truncate max-w-[8rem]">
                {boardName}
              </span>
            )}
            <DueChip
              due={node.dueDatetime}
              hasTime={node.dueHasTime === 1}
              asap={node.dueAsap === 1}
              done={done}
            />
            {reminderFired(node) && (
              <span title="Reminder has gone off" className="shrink-0 text-amber-400">
                <Bell className="h-2.5 w-2.5" />
              </span>
            )}
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
            onClick={onAddSubtask}
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
  );
}
