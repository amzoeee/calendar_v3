'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Date-bearing views the mini calendar can navigate within.
const DATE_VIEWS = ['calendar', 'weekly', 'stats'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Google-Calendar-style mini month for the sidebar. Clicking a day jumps to
 * that date, preserving whichever date-bearing view you're currently on
 * (daily / weekly / stats). Hidden on pages that carry no date (e.g. Settings).
 */
export default function MiniCalendar() {
  const router = useRouter();
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);
  const isDateView = DATE_VIEWS.includes(segments[0]);
  const view = isDateView ? segments[0] : 'calendar';
  const selectedStr =
    segments[1] && DATE_RE.test(segments[1]) ? segments[1] : toDateStr(new Date());
  const selected = new Date(selectedStr + 'T00:00:00');
  const todayStr = toDateStr(new Date());

  // The month currently shown in the grid (anchored to its 1st).
  const [viewDate, setViewDate] = useState<Date>(
    new Date(selected.getFullYear(), selected.getMonth(), 1)
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Follow the selected date's month when navigation changes it elsewhere.
  // (Adjust-state-during-render pattern — no effect, no extra commit.)
  const [prevSelected, setPrevSelected] = useState(selectedStr);
  if (prevSelected !== selectedStr) {
    setPrevSelected(selectedStr);
    setViewDate(new Date(selected.getFullYear(), selected.getMonth(), 1));
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

  // Don't render on pages without a date (e.g. Settings).
  if (!isDateView) return null;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Year range for the picker, centered generously around the shown year.
  const years = Array.from({ length: 21 }, (_, i) => year - 10 + i);

  // 6-week grid (42 cells) starting on the Sunday on/before the 1st.
  const firstWeekday = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const cells = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
  );

  const goMonth = (delta: number) => setViewDate(new Date(year, month + delta, 1));
  const handleDayClick = (d: Date) => router.push(`/${view}/${toDateStr(d)}`);

  return (
    <div className="px-4 pt-4">
      <div className="bg-secondary/40 border border-border rounded-lg p-3">
        {/* Header: month + prev/next */}
        <div className="relative flex items-center justify-between mb-2">
          <button
            onClick={() => goMonth(-1)}
            aria-label="Previous month"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Choose month and year"
            aria-expanded={pickerOpen}
            className="text-xs font-bold text-foreground select-none rounded px-1.5 py-0.5 hover:bg-muted transition cursor-pointer"
          >
            {monthLabel}
          </button>
          <button
            onClick={() => goMonth(1)}
            aria-label="Next month"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Month + year picker */}
          {pickerOpen && (
            <div
              ref={pickerRef}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-20 bg-card border border-border rounded-lg shadow-lg p-2 flex gap-2"
            >
              <select
                aria-label="Month"
                value={month}
                onChange={(e) => setViewDate(new Date(year, Number(e.target.value), 1))}
                className="bg-secondary border border-border rounded text-xs text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={year}
                onChange={(e) => setViewDate(new Date(Number(e.target.value), month, 1))}
                className="bg-secondary border border-border rounded text-xs text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Weekday labels */}
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="text-center text-[9px] font-semibold text-muted-foreground select-none"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) => {
            const dStr = toDateStr(d);
            const inMonth = d.getMonth() === month;
            const isToday = dStr === todayStr;
            const isSelected = dStr === selectedStr;

            const cls = isSelected
              ? 'bg-primary text-primary-foreground font-bold'
              : isToday
                ? 'ring-1 ring-primary/50 text-foreground font-bold hover:bg-muted'
                : inMonth
                  ? 'text-foreground hover:bg-muted'
                  : 'text-muted-foreground/40 hover:bg-muted/50';

            return (
              <button
                key={i}
                onClick={() => handleDayClick(d)}
                aria-label={dStr}
                aria-current={isSelected ? 'date' : undefined}
                className={`h-6 w-full rounded text-[10px] font-medium transition cursor-pointer flex items-center justify-center ${cls}`}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
