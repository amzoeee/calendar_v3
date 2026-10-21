'use client';

import { useState } from 'react';
import { splitOffset, type RemindUnit } from '@/lib/taskSchedule';
import Select from '@/app/components/Select';
import { FIELD_CLASS } from '../fieldClass';

export const CUSTOM = 'custom';

/** "[n] [unit] before", for a reminder none of the presets cover. */
export default function CustomOffset({
  offset,
  units,
  onChange,
}: {
  offset: number;
  units: RemindUnit[];
  onChange: (offset: number) => void;
}) {
  const initial = splitOffset(offset, units);
  // Kept as text so the field can be emptied mid-edit without saving.
  const [amount, setAmount] = useState(String(initial.amount));
  const [unit, setUnit] = useState(initial.unit);

  const save = (text: string, u: RemindUnit) => {
    const n = Number(text);
    if (text !== '' && Number.isInteger(n) && n >= 0) onChange(n * u.size);
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={amount}
        aria-label="Reminder amount"
        onChange={(e) => {
          setAmount(e.target.value);
          save(e.target.value, unit);
        }}
        onBlur={() => {
          if (amount === '' || !Number.isInteger(Number(amount)) || Number(amount) < 0) {
            const saved = splitOffset(offset, units);
            setAmount(String(saved.amount));
            setUnit(saved.unit);
          }
        }}
        className={`${FIELD_CLASS} w-16`}
      />
      <Select<number>
        value={unit.size}
        aria-label="Reminder unit"
        onChange={(size) => {
          const u = units.find((x) => x.size === size)!;
          setUnit(u);
          save(amount, u);
        }}
        className={`${FIELD_CLASS} flex-1 min-w-0 cursor-pointer`}
        options={units.map((u) => ({ value: u.size, label: amount === '1' ? u.label : `${u.label}s` }))}
      />
      <span className="text-xs text-muted-foreground">before</span>
    </div>
  );
}
