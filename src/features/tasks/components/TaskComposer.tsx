'use client';

import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { type NewTaskDetails } from '@/lib/tasks';
import { DEFAULT_REMIND_TIME } from '@/lib/taskSchedule';
import DateInput from '@/app/components/DateInput';
import TimeInput from '@/app/components/TimeInput';
import { FIELD_CLASS } from '../fieldClass';
import { type VisibleBoard, type TaskTag, type ColumnHandlers } from '../types';
import ReminderPicker from './ReminderPicker';
import TagPicker from './TagPicker';

/** A column's new-task input, with its expandable deadline/reminder/tags half. */
export default function TaskComposer({
  board,
  availableTags,
  addTask,
  registerComposer,
}: {
  board: VisibleBoard;
  availableTags: TaskTag[];
  addTask: ColumnHandlers['addTask'];
  registerComposer: (boardId: number, el: HTMLInputElement | null) => void;
}) {
  const [composerValue, setComposerValue] = useState('');
  // The composer's expandable half. It applies to one task and then empties
  // itself, so a deadline can never reach a task you didn't set it on.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [draftAsap, setDraftAsap] = useState(false);
  const [draftTagIds, setDraftTagIds] = useState<number[]>([]);
  const [draftRemindMinutes, setDraftRemindMinutes] = useState<number | null>(null);
  const [draftRemindDays, setDraftRemindDays] = useState<number | null>(null);
  const [draftRemindTime, setDraftRemindTime] = useState(DEFAULT_REMIND_TIME);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const composerDetails: NewTaskDetails = {
    dueDate: draftDate || null,
    dueTime: draftTime || null,
    asap: draftAsap,
    tagIds: draftTagIds,
    remindOffsetMinutes: draftRemindMinutes,
    remindOffsetDays: draftRemindDays,
    remindTimeOfDay: draftRemindDays != null ? draftRemindTime : null,
  };

  // Spent on the task it was set for. The panel stays open, empty and ready,
  // rather than quietly carrying a deadline onto whatever you type next.
  const clearDetails = () => {
    setDraftDate('');
    setDraftTime('');
    setDraftAsap(false);
    setDraftTagIds([]);
    setDraftRemindMinutes(null);
    setDraftRemindDays(null);
    setDraftRemindTime(DEFAULT_REMIND_TIME);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    clearDetails();
  };

  return (
    <div className="mb-1.5 border-b border-border">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
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
              addTask(
                board.id,
                composerValue,
                null,
                composerDetails,
                board.virtual === 'starred'
              );
              setComposerValue('');
              clearDetails();
            }
            if (e.key === 'Escape') {
              setComposerValue('');
              closeDetails();
              inputRef.current?.blur();
            }
          }}
          /* A list that isn't a list still has to put a new task
             somewhere. It goes to the first list, named here rather than
             left to be discovered. */
          placeholder={board.virtual ? `Add to ${board.targetName}` : 'Add a task'}
          className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-1"
        />
        <button
          onClick={() => (detailsOpen ? closeDetails() : setDetailsOpen(true))}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? 'Hide deadline, reminder and tags' : 'Add a deadline, reminder or tags'}
          title="Deadline, reminder and tags"
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
        >
          {detailsOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Deadline, reminder and tags before the task exists, so the common
          case — "read chapter 4, due Friday, #school" — is one step
          instead of create, open, fill in. */}
      {detailsOpen && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex gap-1.5 items-center">
            {draftAsap ? (
              <p className="flex-1 min-w-0 text-[10px] text-muted-foreground">
                Due as soon as possible.
              </p>
            ) : (
              <>
                <DateInput
                  value={draftDate}
                  onChange={setDraftDate}
                  aria-label="Deadline for the new task"
                  className={`${FIELD_CLASS} flex-1 min-w-0 cursor-pointer`}
                />
                <TimeInput
                  value={draftTime}
                  disabled={!draftDate}
                  onChange={setDraftTime}
                  aria-label="Time of day for the new task"
                  className={`${FIELD_CLASS} w-[6.25rem] cursor-pointer disabled:opacity-40`}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setDraftAsap((a) => !a);
                setDraftDate('');
                setDraftTime('');
              }}
              aria-pressed={draftAsap}
              title="Due as soon as possible"
              className={`shrink-0 text-[10px] font-semibold px-1.5 py-1 rounded border transition-colors cursor-pointer ${
                draftAsap
                  ? 'bg-amber-400/15 text-amber-400 border-amber-400/40'
                  : 'text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              ASAP
            </button>
          </div>
          {draftDate && (
            <ReminderPicker
              dueDate={draftDate}
              dueTime={draftTime}
              minutes={draftRemindMinutes}
              days={draftRemindDays}
              remindTime={draftRemindTime}
              onMinutesChange={setDraftRemindMinutes}
              onDaysChange={setDraftRemindDays}
              onRemindTimeChange={setDraftRemindTime}
            />
          )}
          <TagPicker all={availableTags} selected={draftTagIds} onChange={setDraftTagIds} />
        </div>
      )}
    </div>
  );
}
