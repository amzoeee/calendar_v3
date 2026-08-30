'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import EventSearch from '@/app/components/EventSearch';
import { useSwipeNavigation } from '@/lib/useSwipeNavigation';
import { useDateNavigation } from '@/lib/useDateNavigation';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

// The window the page is showing: `date` route param + `end` search param.
interface Range {
  start: string;
  end: string;
}

interface StatsClientProps {
  startDate: string;
  endDate: string;
  weekdaysOnly: boolean;
  tagHoursByDay: Record<string, Record<string, number>>;
  tags: Tag[];
  tasksDoneByDay: Record<string, Record<string, number>>;
  taskPunctuality: { onTime: number; late: number; undated: number };
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) =>
  // Pad the year to 4 digits too — an unpadded 3-digit year (e.g. "202-08-16")
  // is not a parseable date string and renders as "Invalid Date".
  `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const shiftRange = (r: Range, days: number): Range => ({
  start: toDateStr(addDays(new Date(r.start + 'T00:00:00'), days)),
  end: toDateStr(addDays(new Date(r.end + 'T00:00:00'), days)),
});

// A well-formed YYYY-MM-DD that is also a real calendar date with a sensible
// (4-digit) year. Guards against partial entries like "0202-08-15" that the
// native date input can momentarily emit while the year is still being typed.
const isSensibleDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.getFullYear() >= 1000;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-secondary/40 border border-border rounded-lg p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-bold text-foreground tabular-nums mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export default function StatsClient({
  startDate,
  endDate,
  weekdaysOnly,
  tagHoursByDay,
  tags,
  tasksDoneByDay,
  taskPunctuality,
}: StatsClientProps) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  // Build the list of dates in range.
  const rangeDates: Date[] = [];
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    cursor.getTime() <= end.getTime();
    cursor = addDays(cursor, 1)
  ) {
    rangeDates.push(new Date(cursor));
  }
  const rangeLen = rangeDates.length; // in days

  // URL builder — `date` param is the range start, `end` search param the end.
  const buildUrl = (s: string, e: string) =>
    `/stats/${s}?end=${e}&weekdays_only=${weekdaysOnly}`;

  // Paging is debounced, so `activeRange` is the window the user has paged to,
  // which is the rendered range except while a coalesced fetch is catching up.
  // Everything the header offers — the range title, the step targets, the range
  // inputs — reads it, so a held arrow key keeps stepping from where the user
  // is. The chart below keeps rendering the range the server actually sent,
  // until the new one arrives.
  const { active: activeRange, navigateTo } = useDateNavigation<Range>(
    { start: startDate, end: endDate },
    (r) => buildUrl(r.start, r.end),
    (r) => `${r.start}|${r.end}`,
  );
  const { start: activeStartStr, end: activeEndStr } = activeRange;
  const activeStart = new Date(activeStartStr + 'T00:00:00');
  const activeEnd = new Date(activeEndStr + 'T00:00:00');

  // Navigation shifts the whole window by its own length. Shifting preserves
  // that length, so the rendered range's `rangeLen` is also the length of
  // wherever the user has paged to. Memoised because the keydown listener below
  // is rebound whenever these change.
  const prevPeriod = useMemo(
    () => shiftRange({ start: activeStartStr, end: activeEndStr }, -rangeLen),
    [activeStartStr, activeEndStr, rangeLen],
  );
  const nextPeriod = useMemo(
    () => shiftRange({ start: activeStartStr, end: activeEndStr }, rangeLen),
    [activeStartStr, activeEndStr, rangeLen],
  );

  // "Today" keeps the current window length but ends on today.
  const todayPeriod = (): Range => {
    const today = new Date();
    const e = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const s = addDays(e, -(rangeLen - 1));
    return { start: toDateStr(s), end: toDateStr(e) };
  };

  // Preset ranges (keep the current end, extend the start into the past).
  const oneMonthStart = addDays(
    new Date(activeEnd.getFullYear(), activeEnd.getMonth() - 1, activeEnd.getDate()),
    1
  );
  const presets: { label: string; start: string; active: boolean }[] = [
    { label: '1 Week', start: toDateStr(addDays(activeEnd, -6)), active: rangeLen === 7 },
    { label: '2 Weeks', start: toDateStr(addDays(activeEnd, -13)), active: rangeLen === 14 },
    { label: '1 Month', start: toDateStr(oneMonthStart), active: activeRange.start === toDateStr(oneMonthStart) },
  ];

  // Header date display.
  const sameYear = activeStart.getFullYear() === activeEnd.getFullYear();
  const startDisplay = activeStart.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endDisplay = activeEnd.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  // Compact form for the mobile header — "8/2 - 8/8" instead of "Aug 2 - Aug 8, 2026".
  const startDisplayCompact = activeStart.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  const endDisplayCompact = activeEnd.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

  // Per-day totals (used for the tag averages panel below).
  const dayStats = rangeDates.map((day) => {
    const dateStr = toDateStr(day);
    const hours = tagHoursByDay[dateStr] || {};
    const total = Object.values(hours).reduce((a, b) => a + b, 0);
    const weekday = day.getDay();
    const isWeekend = weekday === 0 || weekday === 6;

    return {
      dateStr,
      weekday,
      dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
      dayDisplay: day.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      hours,
      total,
      isWeekend,
    };
  });

  const visibleDays = dayStats.filter((d) => !weekdaysOnly || !d.isWeekend);

  // Gather all unique tags present in the logs
  const allTagsSet = new Set<string>();
  visibleDays.forEach((d) => {
    Object.keys(d.hours).forEach((t) => allTagsSet.add(t));
  });
  const allTags = Array.from(allTagsSet);

  // Sort tags so they stack consistently (matching tags order)
  const tagOrder = tags.map((t) => t.name);
  allTags.sort((a, b) => {
    const idxA = tagOrder.indexOf(a);
    const idxB = tagOrder.indexOf(b);
    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  // Collapse the range into at most 7 bars — one per weekday — so long ranges
  // never need horizontal scrolling. Each bar stacks the *average* hours per tag
  // across that weekday's occurrences (counting only days that had data logged).
  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayIndices = weekdaysOnly ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  const weekdayBars = weekdayIndices.map((wd) => {
    const daysOfWeekday = visibleDays.filter((d) => d.weekday === wd);
    const activeCount = daysOfWeekday.filter((d) => d.total > 0).length;
    const hours: Record<string, number> = {};
    allTags.forEach((tag) => {
      const sum = daysOfWeekday.reduce((s, d) => s + (d.hours[tag] || 0), 0);
      hours[tag] = activeCount > 0 ? sum / activeCount : 0;
    });
    const total = Object.values(hours).reduce((a, b) => a + b, 0);
    return { weekday: wd, dayName: WEEKDAY_LABELS[wd], hours, total, activeCount };
  });

  const maxBarTotal = weekdayBars.reduce((m, b) => Math.max(m, b.total), 0);
  const maxScale = Math.max(8, Math.ceil(maxBarTotal) + 1);

  // Calculate averages per tag across active days (excluding days with 0 hours logged)
  const activeDaysWithData = visibleDays.filter((d) => d.total > 0).length;

  const tagAverages: Record<string, number> = {};
  allTags.forEach((tag) => {
    const totalHours = visibleDays.reduce((sum, d) => sum + (d.hours[tag] || 0), 0);
    tagAverages[tag] = activeDaysWithData > 0 ? totalHours / activeDaysWithData : 0;
  });

  // ---- Task completions ------------------------------------------------
  //
  // Kept as its own section rather than merged into the chart above: hours and
  // counts aren't the same unit, and sharing an axis would misrepresent both.
  const taskDays = visibleDays.map((d) => {
    const counts = tasksDoneByDay[d.dateStr] || {};
    return { ...d, counts, done: Object.values(counts).reduce((a, b) => a + b, 0) };
  });

  const taskTagTotals: Record<string, number> = {};
  for (const d of taskDays) {
    for (const [tag, n] of Object.entries(d.counts)) {
      taskTagTotals[tag] = (taskTagTotals[tag] ?? 0) + n;
    }
  }

  const punctualityTotal =
    taskPunctuality.onTime + taskPunctuality.late + taskPunctuality.undated;
  const dated = taskPunctuality.onTime + taskPunctuality.late;
  const onTimeRate = dated > 0 ? Math.round((taskPunctuality.onTime / dated) * 100) : null;

  const taskActiveDays = taskDays.filter((d) => d.done > 0).length;
  // Per-tag totals double-count a task carrying two tags, so the headline
  // figure comes from the punctuality tally, which counts completions once.
  const totalDone = punctualityTotal;
  const perActiveDay = taskActiveDays > 0 ? totalDone / taskActiveDays : 0;
  const maxTaskDay = taskDays.reduce((m, d) => Math.max(m, d.done), 0);
  const multiTagged = Object.values(taskTagTotals).reduce((a, b) => a + b, 0) > totalDone;

  const getTagColor = (tagName: string) => {
    if (tagName === 'Untagged') return '#6b7280';
    return tags.find((t) => t.name === tagName)?.color || '#6b7280';
  };

  const handleToggleWeekdays = () => {
    // Not a range change — same window, different filter — but it still goes
    // through navigateTo so a page still sitting in the debounce can't land
    // afterwards and undo it.
    navigateTo(
      activeRange,
      `/stats/${activeRange.start}?end=${activeRange.end}&weekdays_only=${!weekdaysOnly}`,
    );
  };

  // Mobile: the presets/custom-range/weekdays-only row is too much to show at
  // once on a phone, so it collapses into a bottom sheet behind this toggle.
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Local copies of the range inputs so typing doesn't navigate mid-entry
  // (which used to reset the field after a single digit). We only commit — and
  // navigate — on blur or Enter, mirroring the event add/edit forms.
  // Tracked against the *active* range, so paging with the arrow keys carries
  // the inputs along with the header instead of leaving them a page behind.
  const [localStart, setLocalStart] = useState(startDate);
  const [localEnd, setLocalEnd] = useState(endDate);
  const [prevRange, setPrevRange] = useState({ start: startDate, end: endDate });
  if (prevRange.start !== activeRange.start || prevRange.end !== activeRange.end) {
    setPrevRange({ start: activeRange.start, end: activeRange.end });
    setLocalStart(activeRange.start);
    setLocalEnd(activeRange.end);
  }

  const commitStart = () => {
    if (!isSensibleDate(localStart)) {
      setLocalStart(activeRange.start); // revert an incomplete/nonsensical entry
      return;
    }
    if (localStart === activeRange.start) return;
    // Keep the end no earlier than the new start.
    const newEnd = localStart > activeRange.end ? localStart : activeRange.end;
    navigateTo({ start: localStart, end: newEnd });
  };

  const commitEnd = () => {
    if (!isSensibleDate(localEnd)) {
      setLocalEnd(activeRange.end); // revert an incomplete/nonsensical entry
      return;
    }
    if (localEnd === activeRange.end) return;
    // Keep the start no later than the new end.
    const newStart = localEnd < activeRange.start ? localEnd : activeRange.start;
    navigateTo({ start: newStart, end: localEnd });
  };

  // Keyboard arrow navigation — shifts by the range length.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      if (!isInput && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateTo(prevPeriod);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateTo(nextPeriod);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [navigateTo, prevPeriod, nextPeriod]);

  // Mobile paging: swipe sideways to shift the range by its own length, same
  // as the arrow keys above. The hook ignores gestures that start inside the
  // horizontally scrollable bar chart, which owns that axis itself.
  const swipeRef = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => navigateTo(nextPeriod),
    onSwipeRight: () => navigateTo(prevPeriod),
    enabled: !showMobileFilters,
  });

  return (
    <div ref={swipeRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* Header controls */}
      <div className="border-b border-border flex flex-col gap-3 px-3 md:px-6 py-3 shrink-0 glass-panel">
        {/* Row 1: navigation + title + toggle */}
        <div className="flex items-center justify-between gap-2 md:gap-4 md:flex-wrap">
          <div className="flex items-center gap-1.5 md:gap-3">
            <button
              onClick={() => navigateTo(prevPeriod)}
              className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
            </button>
            <button
              onClick={() => navigateTo(todayPeriod())}
              className="px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => navigateTo(nextPeriod)}
              className="p-1.5 md:p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>

          <h1 className="text-sm md:text-xl font-bold tracking-tight truncate min-w-0">
            <span className="hidden md:inline">Stats: </span>
            <span className="md:hidden">{startDisplayCompact} – {endDisplayCompact}</span>
            <span className="hidden md:inline">{startDisplay} – {endDisplay}</span>
          </h1>

          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <button
              onClick={() => setShowMobileFilters(true)}
              className="md:hidden p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
              aria-label="Range and filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <label className="hidden md:flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={weekdaysOnly}
                onChange={handleToggleWeekdays}
                className="rounded bg-secondary border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Weekdays Only
              </span>
            </label>
            <span className="hidden md:inline-block px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
              Stats
            </span>
            <EventSearch tags={tags} />
          </div>
        </div>

        {/* Row 2: presets + custom range pickers (desktop only — see the mobile filter sheet below) */}
        <div className="hidden md:flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => navigateTo({ start: p.start, end: activeRange.end })}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                  p.active
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-secondary border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-border" />

          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="uppercase tracking-wider">From</span>
            <input
              type="date"
              value={localStart}
              max={localEnd}
              onChange={(e) => setLocalStart(e.target.value)}
              onBlur={commitStart}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="bg-secondary border border-border px-2 py-1 rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="uppercase tracking-wider">To</span>
            <input
              type="date"
              value={localEnd}
              min={localStart}
              onChange={(e) => setLocalEnd(e.target.value)}
              onBlur={commitEnd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="bg-secondary border border-border px-2 py-1 rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-muted-foreground/70 normal-case tracking-normal">
              ({rangeLen} day{rangeLen === 1 ? '' : 's'} ·{' '}
              <span className="relative group/active cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
                {activeDaysWithData} active
                <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-60 -translate-x-1/2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-normal leading-snug text-muted-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/active:opacity-100">
                  An <span className="font-semibold text-foreground">active day</span> is a day in this range with at least one logged event. Daily averages are computed over these days only.
                </span>
              </span>)
            </span>
          </div>
        </div>
      </div>

      {/* TASKS COMPLETED — its own section, because counts and hours are not
          the same unit and sharing an axis would misrepresent both. */}
      <div className="shrink-0 px-4 md:px-8 pb-4 md:pb-8">
        <div className="bg-card rounded-xl border border-border p-4 md:p-6 space-y-4">
          <div>
            <h2 className="text-lg md:text-xl font-bold tracking-tight">Tasks Completed</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalDone === 0
                ? 'Nothing ticked off in this range.'
                : `${totalDone} task${totalDone === 1 ? '' : 's'} over ${taskActiveDays} active day${taskActiveDays === 1 ? '' : 's'} — ${perActiveDay.toFixed(1)} a day`}
            </p>
          </div>

          {totalDone > 0 && (
            <>
              {/* Per-day bars, stacked by tag. */}
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-28 min-w-[420px]">
                  {taskDays.map((d) => (
                    <div key={d.dateStr} className="flex-1 h-full flex flex-col justify-end group/bar">
                      <div className="w-full flex flex-col-reverse rounded-t overflow-hidden">
                        {Object.entries(d.counts).map(([tag, n]) => (
                          <div
                            key={tag}
                            title={`${d.dayDisplay} · ${tag}: ${n}`}
                            style={{
                              height: `${maxTaskDay > 0 ? (n / maxTaskDay) * 96 : 0}px`,
                              backgroundColor: getTagColor(tag),
                            }}
                          />
                        ))}
                      </div>
                      <span className="text-[9px] text-muted-foreground text-center mt-1 truncate">
                        {d.done > 0 ? d.done : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Completed" value={String(totalDone)} />
                <Stat label="Per active day" value={perActiveDay.toFixed(1)} />
                <Stat
                  label="On time"
                  value={onTimeRate == null ? '—' : `${onTimeRate}%`}
                  hint={
                    onTimeRate == null
                      ? 'No deadlines to judge against'
                      : `${taskPunctuality.onTime} on time · ${taskPunctuality.late} late`
                  }
                />
                <Stat
                  label="No deadline"
                  value={String(taskPunctuality.undated)}
                  hint="Not counted in the on-time rate"
                />
              </div>

              {/* A grid rather than a stack: one tag per full-width row left a
                  lake of space between a short tag name and its count. One
                  column on a phone, more as the card gets wider. */}
              {Object.keys(taskTagTotals).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
                  {Object.entries(taskTagTotals)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, n]) => (
                      <div key={tag} className="flex items-center gap-2 text-sm min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: getTagColor(tag) }}
                        />
                        <span className="flex-1 truncate text-foreground">{tag}</span>
                        <span className="text-muted-foreground tabular-nums">{n}</span>
                      </div>
                    ))}
                  {multiTagged && (
                    <p className="col-span-full text-[11px] text-muted-foreground pt-1">
                      A task with two tags counts under each, so these add up to more
                      than {totalDone}.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* MOBILE FILTERS SHEET — presets, custom range, weekdays-only toggle */}
      {showMobileFilters && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileFilters(false)} />
          <div className="relative w-full max-h-[85vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl p-5 pb-8 space-y-5">
            <div className="w-9 h-1 rounded-full bg-muted mx-auto" />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold tracking-tight">Range and filters</h2>
              <button
                onClick={() => setShowMobileFilters(false)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Presets</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => navigateTo({ start: p.start, end: activeRange.end })}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                      p.active
                        ? 'bg-primary/20 border-primary text-primary'
                        : 'bg-secondary border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Custom range</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">From</label>
                  <input
                    type="date"
                    value={localStart}
                    max={localEnd}
                    onChange={(e) => setLocalStart(e.target.value)}
                    onBlur={commitStart}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">To</label>
                  <input
                    type="date"
                    value={localEnd}
                    min={localStart}
                    onChange={(e) => setLocalEnd(e.target.value)}
                    onBlur={commitEnd}
                    className="block w-full rounded bg-secondary border border-border px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground/70 mt-2">
                {rangeLen} day{rangeLen === 1 ? '' : 's'} · {activeDaysWithData} active
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={weekdaysOnly}
                onChange={handleToggleWeekdays}
                className="rounded bg-secondary border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <span className="text-sm font-medium text-foreground">Weekdays only</span>
            </label>
          </div>
        </div>
      )}

      {/* Main Page Area. `min-h-0` so this is what scrolls — without it the
          flex default of `min-height: auto` lets the content push the page past
          the layout's <main>, which then scrolls instead. On a phone that hands
          the scroll to the element the browser treats as the page root, whose
          OS-drawn overlay scrollbar ignores our styling. */}
      <div className="flex-1 min-h-0 p-4 md:p-8 overflow-y-auto flex flex-col lg:flex-row gap-4 md:gap-8">

        {/* Stacked Bar Chart */}
        <div className="flex-1 bg-card rounded-xl border border-border p-4 md:p-6 flex flex-col justify-between min-h-[400px]">
          <div>
            <h2 className="text-lg font-bold">Time Breakdown by Weekday</h2>
            <p className="text-xs text-muted-foreground mt-1">Average hours logged per weekday across the range</p>
          </div>

          {/* Grid Chart — horizontally scrollable on mobile since 7 bars don't
              fit a phone width at a legible size (see the fixed inner width below) */}
          <div className="flex-1 mt-8 overflow-x-auto md:overflow-visible">
            <div className="relative h-full w-[460px] md:w-full">

            {/* Y Axis Guide Lines */}
            <div className="absolute left-10 right-0 top-0 bottom-8 flex flex-col justify-between pointer-events-none select-none">
              {Array.from({ length: 5 }).map((_, idx) => {
                const val = Math.round((maxScale / 4) * (4 - idx) * 10) / 10;
                return (
                  <div key={idx} className="relative w-full border-t border-border/20 flex items-center">
                    <span className="absolute -left-10 text-[9px] font-bold text-muted-foreground">
                      {val}h
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bars Column — one averaged bar per weekday (max 7, no scroll) */}
            <div className="absolute left-10 right-0 top-0 bottom-0">
              <div className="h-full w-full flex items-stretch justify-around gap-2">
                {weekdayBars.map((day, idx) => (
                  <div
                    key={idx}
                    className="flex-1 min-w-[40px] max-w-[110px] h-full flex flex-col group/bar"
                  >
                    {/* Bar area */}
                    <div className="flex-1 w-full relative flex flex-col justify-end pb-8">
                      {/* Stacked tag block wrapper */}
                      <div
                        className="w-full rounded bg-secondary/30 border border-border/50 overflow-hidden flex flex-col-reverse justify-start transition-all"
                        style={{ height: `${(day.total / maxScale) * 100}%` }}
                      >
                        {allTags.map((tag) => {
                          const hrs = day.hours[tag] || 0;
                          if (hrs === 0) return null;
                          const blockHeightPercent = (hrs / day.total) * 100;

                          return (
                            <div
                              key={tag}
                              className="w-full hover:brightness-110 transition-all relative group/segment"
                              style={{
                                height: `${blockHeightPercent}%`,
                                backgroundColor: getTagColor(tag),
                              }}
                            >
                              {/* Segment Tooltip */}
                              <div className="absolute opacity-0 group-hover/segment:opacity-100 bg-black text-white text-[9px] font-semibold p-1.5 rounded pointer-events-none z-30 transition-all -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border">
                                {tag}: {hrs.toFixed(1)} hrs avg
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Day label below bar */}
                    <div className="h-8 pt-1 text-center select-none">
                      <p className="text-[11px] font-bold text-foreground leading-tight">{day.dayName}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">
                        {day.activeCount === 0
                          ? 'no data'
                          : `avg of ${day.activeCount} day${day.activeCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            </div>
          </div>
        </div>

        {/* Tag Averages Panel. Stretching this card pins it to the row's
            height, so once there are more tags than fit, the extra rows spill
            out past its own border instead of making it taller. `lg:self-start`
            lets it size to its rows; `lg:min-h-full` keeps the row height as a
            floor, so a short list still matches the chart the way it used to. */}
        <div className="w-full lg:self-start lg:min-h-full lg:w-96 bg-card rounded-xl border border-border p-4 md:p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold">Daily Averages</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Average hours logged per tag (based on {activeDaysWithData} active day{activeDaysWithData === 1 ? '' : 's'})
            </p>
          </div>

          <div className="space-y-3">
            {allTags.length > 0 ? (
              allTags
                .map((tag) => ({
                  name: tag,
                  color: getTagColor(tag),
                  average: tagAverages[tag] || 0,
                }))
                // Sort by average descending
                .sort((a, b) => b.average - a.average)
                .map((tag) => (
                  <div key={tag.name} className="flex items-center justify-between p-3 bg-secondary/35 rounded-lg border border-border/40">
                    <div className="flex items-center gap-3 truncate">
                      <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                      <span className="text-sm font-semibold truncate text-foreground">{tag.name}</span>
                    </div>
                    <span className="text-sm font-extrabold text-primary">
                      {tag.average.toFixed(1)}h / day
                    </span>
                  </div>
                ))
            ) : (
              <div className="text-center py-12 border border-dashed border-border rounded-lg">
                <p className="text-sm text-muted-foreground">No events logged in this range.</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
