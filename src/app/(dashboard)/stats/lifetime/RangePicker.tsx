'use client';

import DateInput from '@/app/components/DateInput';
import { dateOfColumnStr, type LifetimeRange } from '@/lib/lifetime';

interface RangePickerProps {
  range: LifetimeRange;
  // The columns currently shown, used to prefill a custom range.
  firstDay: number;
  lastDay: number;
  onChange: (range: LifetimeRange) => void;
}

const PRESETS: { kind: LifetimeRange['kind']; label: string }[] = [
  { kind: 'all', label: 'All time' },
  { kind: 'year', label: 'This year' },
  { kind: 'custom', label: 'Custom' },
];

// DateInput emits years as they're typed ("0002"); wait for a real one.
const isComplete = (v: string) => v >= '1970-01-01';

export default function RangePicker({ range, firstDay, lastDay, onChange }: RangePickerProps) {
  const pick = (kind: LifetimeRange['kind']) => {
    if (kind === range.kind) return;
    onChange(
      kind === 'custom'
        ? { kind, from: dateOfColumnStr(firstDay), to: dateOfColumnStr(lastDay) }
        : { kind },
    );
  };

  // Moving one end past the other drags the other along.
  const setFrom = (from: string) => {
    if (range.kind !== 'custom' || !isComplete(from)) return;
    onChange({ kind: 'custom', from, to: from > range.to ? from : range.to });
  };
  const setTo = (to: string) => {
    if (range.kind !== 'custom' || !isComplete(to)) return;
    onChange({ kind: 'custom', from: to < range.from ? to : range.from, to });
  };

  const inputClass =
    'bg-secondary border border-border px-2 py-1 rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-28';

  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.kind}
            onClick={() => pick(p.kind)}
            aria-pressed={range.kind === p.kind}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
              range.kind === p.kind
                ? 'bg-primary/20 border-primary text-primary'
                : 'bg-secondary border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {range.kind === 'custom' && (
        <div className="flex items-center gap-1.5">
          <DateInput value={range.from} onChange={setFrom} aria-label="Start date" className={inputClass} />
          <span className="text-xs text-muted-foreground">–</span>
          <DateInput value={range.to} onChange={setTo} aria-label="End date" className={inputClass} />
        </div>
      )}
    </div>
  );
}
