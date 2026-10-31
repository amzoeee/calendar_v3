'use client';

import { useState } from 'react';
import { CalendarPlus, SkipForward } from 'lucide-react';
import { type TaskRow } from '@/lib/tasks';
import { postponeLabel, REPEAT_OPTIONS } from '@/lib/taskSchedule';
import Select from '@/app/components/Select';
import { FIELD_CLASS } from '../fieldClass';
import Button from '@/app/components/Button';

/**
 * Repeat rule and optional numbering for one task.
 *
 * Recurrence here is rolling — the row advances rather than a run of rows
 * being generated up front — so this edits the single task rather than a
 * series, and there's no "this one or all of them?" to ask.
 *
 * A repeat needs a deadline to advance from, so the control stays disabled
 * until there is one.
 */
export default function RepeatPicker({
  task,
  onSave,
  onSkip,
  onPostpone,
}: {
  task: TaskRow;
  onSave: (rrule: string | null, start: number | null, end: number | null) => void;
  onSkip: () => void;
  onPostpone: () => void;
}) {
  const [rrule, setRrule] = useState<string | null>(task.rrule);
  const [start, setStart] = useState<string>(
    task.counterValue == null ? '' : String(task.counterValue)
  );
  const [end, setEnd] = useState<string>(task.counterEnd == null ? '' : String(task.counterEnd));

  const hasDeadline = Boolean(task.dueDatetime);
  const numbered = task.title.includes('{n}');

  const field = FIELD_CLASS;

  const commit = (next: { rrule?: string | null; start?: string; end?: string }) => {
    const r = next.rrule !== undefined ? next.rrule : rrule;
    const st = next.start ?? start;
    const en = next.end ?? end;
    onSave(r, st === '' ? null : Number(st), en === '' ? null : Number(en));
  };

  return (
    <div className="space-y-1">
      <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Repeat
      </span>
      <Select
        value={rrule ?? ''}
        disabled={!hasDeadline}
        onChange={(value) => {
          const v = value || null;
          setRrule(v);
          commit({ rrule: v });
        }}
        className={`${field} w-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
        options={REPEAT_OPTIONS.map((o) => ({ value: o.rrule ?? '', label: o.label }))}
      />

      {!hasDeadline && (
        <p className="text-[10px] text-muted-foreground">Set a deadline first.</p>
      )}

      {rrule && (
        <>
          {numbered ? (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground shrink-0">
                <code>{'{n}'}</code> from
              </span>
              <input
                type="number"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  commit({ start: e.target.value });
                }}
                className={`${field} w-14`}
              />
              <span className="text-[10px] text-muted-foreground shrink-0">to</span>
              <input
                type="number"
                value={end}
                placeholder="∞"
                onChange={(e) => {
                  setEnd(e.target.value);
                  commit({ end: e.target.value });
                }}
                className={`${field} w-14`}
              />
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Put <code>{'{n}'}</code> in the title to number each one.
            </p>
          )}

          {/* Postpone and skip sit together because the difference between
              them is the thing worth seeing: postponing keeps this
              occurrence and moves it, skipping gives up on it and counts it
              as gone. The postpone label names the step it will take. */}
          {postponeLabel(rrule) && (
            <Button
              variant="ghost"
              size="none"
              onClick={onPostpone}
              title="Same task, later"
              className="w-full gap-2 px-2 py-2 rounded text-sm md:text-xs text-foreground"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Postpone {postponeLabel(rrule)}
            </Button>
          )}

          <Button
            variant="ghost"
            size="none"
            onClick={onSkip}
            title="Not doing this one"
            className="w-full gap-2 px-2 py-2 rounded text-sm md:text-xs text-foreground"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip this one
          </Button>
        </>
      )}
    </div>
  );
}
