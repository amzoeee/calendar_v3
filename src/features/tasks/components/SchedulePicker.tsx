'use client';

import { useState } from 'react';
import { type TaskRow } from '@/lib/tasks';
import {
  pacificDbStringToDate,
  formatDateInputValue,
  formatTimeInputValue,
  shiftDateStr,
  getBrowserTimeZone,
} from '@/lib/timezone';
import {
  TIMED_PRESETS,
  DATED_PRESETS,
  DEFAULT_REMIND_TIME,
  localRemindTime,
  TIMED_UNITS,
  DATED_UNITS,
} from '@/lib/taskSchedule';
import DateInput from '@/app/components/DateInput';
import TimeInput from '@/app/components/TimeInput';
import Select from '@/app/components/Select';
import { CUSTOM } from './CustomOffset';
import { FIELD_CLASS } from '../fieldClass';
import CustomOffset from './CustomOffset';

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
  const [customOpen, setCustomOpen] = useState(false);

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

  // The reminder in whichever shape the deadline currently takes.
  const presets = dueTime ? TIMED_PRESETS : DATED_PRESETS;
  const offset = dueTime ? minutes : days;
  const setOffset = (v: number | null) => {
    if (dueTime) {
      setMinutes(v);
      commit({ minutes: v });
    } else {
      setDays(v);
      commit({ days: v });
    }
  };
  const showCustom =
    offset != null &&
    (customOpen || !presets.some((p) => (dueTime ? p.minutes : p.days) === offset));

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
          <button
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
          </button>
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
          <div className="flex gap-1.5">
            <Select<number | '' | typeof CUSTOM>
              value={showCustom ? CUSTOM : (offset ?? '')}
              onChange={(value) => {
                if (value === CUSTOM) {
                  setCustomOpen(true);
                  if (offset == null) setOffset(dueTime ? 60 : 1);
                  return;
                }
                setCustomOpen(false);
                setOffset(value === '' ? null : value);
              }}
              className={`${field} flex-1 min-w-0 cursor-pointer`}
              options={[
                { value: '', label: 'No reminder' },
                ...presets.map((p) => ({
                  value: (dueTime ? p.minutes : p.days) ?? ('' as const),
                  label: p.label,
                })),
                { value: CUSTOM, label: 'Custom…' },
              ]}
            />
            {!dueTime && days != null && (
              <TimeInput
                value={remindTime}
                onChange={(v) => {
                  setRemindTime(v);
                  commit({ remindTime: v });
                }}
                className={`${field} w-[6.25rem] cursor-pointer`}
              />
            )}
          </div>
          {showCustom && offset != null && (
            <CustomOffset
              // Remount when the deadline changes shape, so the units re-derive.
              key={dueTime ? 'timed' : 'dated'}
              offset={offset}
              units={dueTime ? TIMED_UNITS : DATED_UNITS}
              onChange={setOffset}
            />
          )}
          {preview && <p className="text-[10px] text-muted-foreground">Reminds {preview}</p>}
        </div>
      )}
    </div>
  );
}
