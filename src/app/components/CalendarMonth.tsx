'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DEFAULT_WEEK_START, weekdayOrder, type WeekStart } from '@/lib/week';

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Indexed by Date#getDay, so the grid can label whichever day comes first.
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SIZES = {
  sm: {
    header: 'text-xs',
    chevron: 'h-4 w-4',
    weekday: 'text-[9px]',
    gap: 'gap-0.5',
    day: 'h-6 text-[10px]',
    picker: 'w-48',
    month: 'py-1.5 text-[11px]',
  },
  lg: {
    header: 'text-sm',
    chevron: 'h-5 w-5',
    weekday: 'text-xs',
    gap: 'gap-1',
    day: 'h-10 text-sm',
    picker: 'w-64',
    month: 'py-2.5 text-sm',
  },
};

/**
 * One month of days with prev/next and a month/year picker. Shared by the
 * sidebar's MiniCalendar and DateInput's picker.
 */
export default function CalendarMonth({
  selected,
  onSelect,
  weekStart = DEFAULT_WEEK_START,
  size = 'sm',
}: {
  /** 'YYYY-MM-DD', or null for nothing selected (the grid opens on today). */
  selected: string | null;
  onSelect: (dateStr: string) => void;
  weekStart?: WeekStart;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  const todayStr = toDateStr(new Date());
  const anchor = new Date((selected ?? todayStr) + 'T00:00:00');

  // The month currently shown in the grid (anchored to its 1st).
  const [viewDate, setViewDate] = useState<Date>(
    new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // The year the picker is browsing, independent of the grid until a month is picked.
  const [pickerYear, setPickerYear] = useState(viewDate.getFullYear());
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);

  // Follow the selected date's month when it changes elsewhere.
  // (Adjust-state-during-render pattern — no effect, no extra commit.)
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    if (selected) setViewDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }

  // Close the month/year picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  // Start keyboard users on the month being shown.
  useEffect(() => {
    if (!pickerOpen) return;
    pickerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-month="${viewDate.getMonth()}"]`)
      ?.focus();
    // Only on open: moving between years shouldn't pull focus around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // 6-week grid (42 cells) starting on the week's first day on/before the 1st.
  const firstWeekday = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const cells = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
  );

  const goMonth = (delta: number) => setViewDate(new Date(year, month + delta, 1));

  const togglePicker = () => {
    if (!pickerOpen) setPickerYear(year);
    setPickerOpen(!pickerOpen);
  };

  const pickMonth = (m: number) => {
    setViewDate(new Date(pickerYear, m, 1));
    setPickerOpen(false);
    pickerButtonRef.current?.focus();
  };

  // Arrows walk the month grid, PageUp/PageDown flip the year, Escape backs out.
  const handlePickerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setPickerOpen(false);
      pickerButtonRef.current?.focus();
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      setPickerYear((y) => y + (e.key === 'PageUp' ? -1 : 1));
      return;
    }
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    const current = (document.activeElement as HTMLElement | null)?.dataset.month;
    if (!(e.key in moves) || current === undefined) return;
    e.preventDefault();
    let next = Number(current) + moves[e.key];
    // Stepping off either end of the year carries into the next one.
    if (next < 0 || next > 11) {
      setPickerYear((y) => y + (next < 0 ? -1 : 1));
      next = (next + 12) % 12;
    }
    pickerRef.current?.querySelector<HTMLButtonElement>(`[data-month="${next}"]`)?.focus();
  };

  return (
    <>
      {/* Header: month + prev/next */}
      <div className="relative flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => goMonth(-1)}
          aria-label="Previous month"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <ChevronLeft className={s.chevron} />
        </button>
        <button
          type="button"
          ref={pickerButtonRef}
          onClick={togglePicker}
          aria-label="Choose month and year"
          aria-expanded={pickerOpen}
          className={`${s.header} font-bold text-foreground select-none rounded px-1.5 py-0.5 hover:bg-muted transition cursor-pointer`}
        >
          {monthLabel}
        </button>
        <button
          type="button"
          onClick={() => goMonth(1)}
          aria-label="Next month"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <ChevronRight className={s.chevron} />
        </button>

        {/* Month + year picker */}
        {pickerOpen && (
          <div
            ref={pickerRef}
            onKeyDown={handlePickerKey}
            className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 z-20 ${s.picker} bg-card border border-border rounded-lg shadow-lg p-2`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <button
                type="button"
                onClick={() => setPickerYear((y) => y - 1)}
                aria-label="Previous year"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <ChevronLeft className={s.chevron} />
              </button>
              <span className={`${s.header} font-bold text-foreground select-none`}>{pickerYear}</span>
              <button
                type="button"
                onClick={() => setPickerYear((y) => y + 1)}
                aria-label="Next year"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <ChevronRight className={s.chevron} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {MONTHS.map((m, i) => {
                const isShown = pickerYear === year && i === month;
                const isThisMonth =
                  pickerYear === new Date().getFullYear() && i === new Date().getMonth();
                return (
                  <button
                    type="button"
                    key={m}
                    data-month={i}
                    onClick={() => pickMonth(i)}
                    aria-label={`${m} ${pickerYear}`}
                    aria-current={isShown ? 'date' : undefined}
                    className={`${s.month} rounded font-medium transition cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                      isShown
                        ? 'bg-primary text-primary-foreground'
                        : isThisMonth
                          ? 'text-foreground bg-secondary hover:bg-muted'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Weekday labels */}
      <div className={`grid grid-cols-7 ${s.gap} mb-1`}>
        {weekdayOrder(weekStart).map((day, i) => (
          <div
            key={i}
            className={`text-center ${s.weekday} font-semibold text-muted-foreground select-none`}
          >
            {WEEKDAY_INITIALS[day]}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className={`grid grid-cols-7 ${s.gap}`}>
        {cells.map((d, i) => {
          const dStr = toDateStr(d);
          const inMonth = d.getMonth() === month;
          const isToday = dStr === todayStr;
          const isSelected = dStr === selected;

          const cls = isSelected
            ? 'bg-primary text-primary-foreground font-bold'
            : isToday
              ? 'ring-1 ring-primary/50 text-foreground font-bold hover:bg-muted'
              : inMonth
                ? 'text-foreground hover:bg-muted'
                : 'text-muted-foreground/40 hover:bg-muted/50';

          return (
            <button
              type="button"
              key={i}
              onClick={() => onSelect(dStr)}
              aria-label={dStr}
              aria-current={isSelected ? 'date' : undefined}
              className={`${s.day} w-full rounded font-medium transition cursor-pointer flex items-center justify-center ${cls}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </>
  );
}
