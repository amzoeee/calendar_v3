'use client';

import { useState } from 'react';
import { shiftDateStr } from '@/lib/timezone';
import { TIMED_PRESETS, DATED_PRESETS, TIMED_UNITS, DATED_UNITS } from '@/lib/taskSchedule';
import TimeInput from '@/app/components/TimeInput';
import Select from '@/app/components/Select';
import { FIELD_CLASS } from '../fieldClass';
import CustomOffset, { CUSTOM } from './CustomOffset';

/**
 * The reminder half of a schedule: an offset in whichever shape the deadline
 * takes — minutes for a timed one, days plus a time of day for a dated one.
 * Holds no offset of its own, so the caller can keep both shapes across a
 * deadline gaining or losing its time.
 *
 * The preview mirrors the server's rules in the viewer's own timezone.
 */
export default function ReminderPicker({
  dueDate,
  dueTime,
  minutes,
  days,
  remindTime,
  onMinutesChange,
  onDaysChange,
  onRemindTimeChange,
}: {
  dueDate: string;
  dueTime: string;
  minutes: number | null;
  days: number | null;
  remindTime: string;
  onMinutesChange: (v: number | null) => void;
  onDaysChange: (v: number | null) => void;
  onRemindTimeChange: (v: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);

  let preview: string | null = null;
  let at: Date | null = null;
  if (dueTime && minutes != null) {
    at = new Date(`${dueDate}T${dueTime}`);
    at.setMinutes(at.getMinutes() - minutes);
  } else if (!dueTime && days != null) {
    at = new Date(`${shiftDateStr(dueDate, -days)}T${remindTime}`);
  }
  if (at) {
    preview = at.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const presets = dueTime ? TIMED_PRESETS : DATED_PRESETS;
  const offset = dueTime ? minutes : days;
  const setOffset = dueTime ? onMinutesChange : onDaysChange;
  const showCustom =
    offset != null &&
    (customOpen || !presets.some((p) => (dueTime ? p.minutes : p.days) === offset));

  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <Select<number | '' | typeof CUSTOM>
          value={showCustom ? CUSTOM : (offset ?? '')}
          aria-label="Reminder"
          onChange={(value) => {
            if (value === CUSTOM) {
              setCustomOpen(true);
              if (offset == null) setOffset(dueTime ? 60 : 1);
              return;
            }
            setCustomOpen(false);
            setOffset(value === '' ? null : value);
          }}
          className={`${FIELD_CLASS} flex-1 min-w-0 cursor-pointer`}
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
            onChange={onRemindTimeChange}
            aria-label="Reminder time of day"
            className={`${FIELD_CLASS} w-[6.25rem] cursor-pointer`}
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
  );
}
