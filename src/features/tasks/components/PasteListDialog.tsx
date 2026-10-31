'use client';

import { useMemo, useState } from 'react';
import { formatDateInputValue, shiftDateStr } from '@/lib/timezone';
import DateInput from '@/app/components/DateInput';
import Select from '@/app/components/Select';
import Button from '@/app/components/Button';

/**
 * Naming a list, whether it's new or being renamed. Replaces window.prompt,
 * which can't be styled, ignores the app's theme, and on some browsers is
 * suppressed outright.
 */
/**
 * Bulk entry from a pasted list.
 *
 * One task per line; a line indented with a tab or two spaces becomes a
 * subtask of the line above it. Deadlines come from a control rather than from
 * syntax in the text — pasting twelve assignment titles and saying "weekly
 * from Sep 3" is the case this exists for, and it needs no parser to get
 * wrong. Per-line dates wait for the inline-syntax work.
 *
 * The preview is the point: it shows exactly what will be created, including
 * the dates it worked out, before anything is written.
 */
export default function PasteListDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (items: { title: string; depth: number; dueDate: string | null }[]) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'none' | 'same' | 'series'>('none');
  const [startDate, setStartDate] = useState(formatDateInputValue(new Date()));
  const [everyDays, setEveryDays] = useState('7');

  const parsed = useMemo(() => {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const out: { title: string; depth: number; dueDate: string | null }[] = [];
    const step = Number(everyDays) || 1;

    for (const line of lines) {
      const depth = /^(\t| {2,})/.test(line) ? 1 : 0;

      // Only top-level items get dates; a subtask is a step of its parent, not
      // a separate thing with its own deadline. `out.length` minus the
      // subtasks already emitted gives this item's position in the series.
      let dueDate: string | null = null;
      if (depth === 0 && startDate) {
        if (mode === 'same') dueDate = startDate;
        else if (mode === 'series') {
          const position = out.filter((o) => o.depth === 0).length;
          dueDate = shiftDateStr(startDate, position * step);
        }
      }

      out.push({ title: line.trim(), depth, dueDate });
    }
    return out;
  }, [text, mode, startDate, everyDays]);

  const field =
    'rounded bg-secondary border border-border px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
        <div>
          <h2 className="text-sm font-bold text-foreground">Paste a list</h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            One task per line. Indent a line to make it a subtask.
          </p>
        </div>

        <textarea
          autoFocus
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Read ch. 4\n  take notes\n  practice problems\nEssay outline'}
          className={`${field} w-full resize-y font-mono`}
        />

        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deadlines
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={mode}
              onChange={setMode}
              className={`${field} cursor-pointer`}
              options={[
                { value: 'none', label: 'No deadlines' },
                { value: 'same', label: 'Same date for all' },
                { value: 'series', label: 'Spread out, starting…' },
              ]}
            />
            {mode !== 'none' && (
              <DateInput
                value={startDate}
                onChange={setStartDate}
                className={`${field} cursor-pointer`}
              />
            )}
            {mode === 'series' && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                every
                <input
                  type="number"
                  min={1}
                  value={everyDays}
                  onChange={(e) => setEveryDays(e.target.value)}
                  className={`${field} w-14`}
                />
                days
              </span>
            )}
          </div>
        </div>

        {parsed.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview — {parsed.length} task{parsed.length === 1 ? '' : 's'}
            </span>
            <div className="max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
              {parsed.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
                  style={{ paddingLeft: 8 + item.depth * 18 }}
                >
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.dueDate && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {item.dueDate}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="none"
            onClick={onCancel}
            className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={() => parsed.length > 0 && onCreate(parsed)}
            disabled={parsed.length === 0}
            size="none"
            className="px-3 py-2 rounded text-sm font-semibold"
          >
            Create {parsed.length || ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
