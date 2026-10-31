'use client';

import { useState } from 'react';
import { type TaskRow } from '@/lib/tasks';
import {
  pacificDbStringToDate,
  formatDateInputValue,
  formatTimeInputValue,
  getBrowserTimeZone,
} from '@/lib/timezone';
import { DEFAULT_REMIND_TIME, localRemindTime } from '@/lib/taskSchedule';
import DateInput from '@/app/components/DateInput';
import TimeInput from '@/app/components/TimeInput';
import { FIELD_CLASS } from '../fieldClass';
import ReminderPicker from './ReminderPicker';
import Button from '@/app/components/Button';

/**
 * Deadline and reminder for one task.
 *
 * The reminder is stored as an offset, not a fixed moment, so that it follows
 * the deadline when the deadline moves — which is the whole reason recurring
 * tasks will be able to carry one. The offset comes in two shapes because
 * deadlines do: minutes before a deadline that names a time, whole days plus a
 * time of day for one that names only a date.
 */
export default function SchedulePicker({
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
    asap?: boolean;
  }) => void;
}) {
  const [asap, setAsap] = useState(task.dueAsap === 1);
  const initialDue = task.dueDatetime ? pacificDbStringToDate(task.dueDatetime) : null;
  const [dueDate, setDueDate] = useState(initialDue ? formatDateInputValue(initialDue) : '');
  const [dueTime, setDueTime] = useState(
    initialDue && task.dueHasTime ? formatTimeInputValue(initialDue) : ''
  );
  const [minutes, setMinutes] = useState<number | null>(task.remindOffsetMinutes ?? null);
  const [days, setDays] = useState<number | null>(task.remindOffsetDays ?? null);
  const [remindTime, setRemindTime] = useState(() =>
    task.remindTimeOfDay && task.dueDatetime
      ? localRemindTime(task.remindTimeOfDay, task.dueDatetime, getBrowserTimeZone())
      : DEFAULT_REMIND_TIME
  );

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

  const toggleAsap = () => {
    const next = !asap;
    setAsap(next);
    setDueDate('');
    setDueTime('');
    onSave({
      dueDate: null,
      dueTime: null,
      remindOffsetMinutes: null,
      remindOffsetDays: null,
      remindTimeOfDay: null,
      asap: next,
    });
  };

  const field = FIELD_CLASS;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deadline
          </span>
          <Button
            variant="unstyled"
            type="button"
            onClick={toggleAsap}
            aria-pressed={asap}
            disabled={Boolean(task.rrule)}
            title={task.rrule ? 'A repeating task needs a date' : 'Due as soon as possible'}
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              asap
                ? 'bg-amber-400/15 text-amber-400 border-amber-400/40'
                : 'text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            ASAP
          </Button>
        </div>
        {asap ? (
          <p className="text-[10px] text-muted-foreground">Due as soon as possible.</p>
        ) : (
          <div className="flex gap-1.5">
            <DateInput
              value={dueDate}
              onChange={(v) => {
                setDueDate(v);
                commit({ dueDate: v });
              }}
              className={`${field} flex-1 min-w-0 cursor-pointer`}
            />
            <TimeInput
              value={dueTime}
              disabled={!dueDate}
              onChange={(v) => {
                setDueTime(v);
                commit({ dueTime: v });
              }}
              className={`${field} w-[6.25rem] cursor-pointer disabled:opacity-40`}
            />
          </div>
        )}
        {dueDate && !dueTime && (
          <p className="text-[10px] text-muted-foreground">Due any time that day.</p>
        )}
      </div>

      {dueDate && (
        <div className="space-y-1">
          <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Reminder
          </span>
          <ReminderPicker
            dueDate={dueDate}
            dueTime={dueTime}
            minutes={minutes}
            days={days}
            remindTime={remindTime}
            onMinutesChange={(v) => {
              setMinutes(v);
              commit({ minutes: v });
            }}
            onDaysChange={(v) => {
              setDays(v);
              commit({ days: v });
            }}
            onRemindTimeChange={(v) => {
              setRemindTime(v);
              commit({ remindTime: v });
            }}
          />
        </div>
      )}
    </div>
  );
}
