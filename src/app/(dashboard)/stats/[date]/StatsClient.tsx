'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import EventSearch from '@/app/components/EventSearch';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

interface StatsClientProps {
  startDate: string;
  endDate: string;
  weekdaysOnly: boolean;
  tagHoursByDay: Record<string, Record<string, number>>;
  tags: Tag[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) =>
  // Pad the year to 4 digits too — an unpadded 3-digit year (e.g. "202-08-16")
  // is not a parseable date string and renders as "Invalid Date".
  `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// A well-formed YYYY-MM-DD that is also a real calendar date with a sensible
// (4-digit) year. Guards against partial entries like "0202-08-15" that the
// native date input can momentarily emit while the year is still being typed.
const isSensibleDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.getFullYear() >= 1000;
};

export default function StatsClient({
  startDate,
  endDate,
  weekdaysOnly,
  tagHoursByDay,
  tags,
}: StatsClientProps) {
  const router = useRouter();

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

  // Navigation shifts the whole window by its own length.
  const prevUrl = buildUrl(
    toDateStr(addDays(start, -rangeLen)),
    toDateStr(addDays(end, -rangeLen))
  );
  const nextUrl = buildUrl(
    toDateStr(addDays(start, rangeLen)),
    toDateStr(addDays(end, rangeLen))
  );

  // "Today" keeps the current window length but ends on today.
  const todayUrl = () => {
    const today = new Date();
    const e = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const s = addDays(e, -(rangeLen - 1));
    return buildUrl(toDateStr(s), toDateStr(e));
  };

  // Preset ranges (keep the current end, extend the start into the past).
  const oneMonthStart = addDays(
    new Date(end.getFullYear(), end.getMonth() - 1, end.getDate()),
    1
  );
  const presets: { label: string; start: string; active: boolean }[] = [
    { label: '1 Week', start: toDateStr(addDays(end, -6)), active: rangeLen === 7 },
    { label: '2 Weeks', start: toDateStr(addDays(end, -13)), active: rangeLen === 14 },
    { label: '1 Month', start: toDateStr(oneMonthStart), active: startDate === toDateStr(oneMonthStart) },
  ];

  // Header date display.
  const sameYear = start.getFullYear() === end.getFullYear();
  const startDisplay = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endDisplay = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

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

  const getTagColor = (tagName: string) => {
    if (tagName === 'Untagged') return '#6b7280';
    return tags.find((t) => t.name === tagName)?.color || '#6b7280';
  };

  const handleToggleWeekdays = () => {
    router.push(`/stats/${startDate}?end=${endDate}&weekdays_only=${!weekdaysOnly}`);
  };

  // Local copies of the range inputs so typing doesn't navigate mid-entry
  // (which used to reset the field after a single digit). We only commit — and
  // navigate — on blur or Enter, mirroring the event add/edit forms.
  const [localStart, setLocalStart] = useState(startDate);
  const [localEnd, setLocalEnd] = useState(endDate);
  const [prevRange, setPrevRange] = useState({ start: startDate, end: endDate });
  if (prevRange.start !== startDate || prevRange.end !== endDate) {
    setPrevRange({ start: startDate, end: endDate });
    setLocalStart(startDate);
    setLocalEnd(endDate);
  }

  const commitStart = () => {
    if (!isSensibleDate(localStart)) {
      setLocalStart(startDate); // revert an incomplete/nonsensical entry
      return;
    }
    if (localStart === startDate) return;
    // Keep the end no earlier than the new start.
    const newEnd = localStart > endDate ? localStart : endDate;
    router.push(buildUrl(localStart, newEnd));
  };

  const commitEnd = () => {
    if (!isSensibleDate(localEnd)) {
      setLocalEnd(endDate); // revert an incomplete/nonsensical entry
      return;
    }
    if (localEnd === endDate) return;
    // Keep the start no later than the new end.
    const newStart = localEnd < startDate ? localEnd : startDate;
    router.push(buildUrl(newStart, localEnd));
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
          router.push(prevUrl);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          router.push(nextUrl);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [router, prevUrl, nextUrl]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Header controls */}
      <div className="border-b border-border flex flex-col gap-3 px-6 py-3 shrink-0 glass-panel">
        {/* Row 1: navigation + title + toggle */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(prevUrl)}
              className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
              aria-label="Previous period"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => router.push(todayUrl())}
              className="px-3 py-2 text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => router.push(nextUrl)}
              className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
              aria-label="Next period"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <h1 className="text-xl font-bold tracking-tight">
            Stats: {startDisplay} – {endDisplay}
          </h1>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
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
            <span className="px-3 py-1.5 bg-accent/20 border border-accent text-accent-foreground text-xs font-semibold rounded-lg">
              Stats
            </span>
            <EventSearch tags={tags} />
          </div>
        </div>

        {/* Row 2: presets + custom range pickers */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => router.push(buildUrl(p.start, endDate))}
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

      {/* Main Page Area */}
      <div className="flex-1 p-8 overflow-y-auto flex flex-col lg:flex-row gap-8">

        {/* Stacked Bar Chart */}
        <div className="flex-1 bg-card rounded-xl border border-border p-6 flex flex-col justify-between min-h-[400px]">
          <div>
            <h2 className="text-lg font-bold">Time Breakdown by Weekday</h2>
            <p className="text-xs text-muted-foreground mt-1">Average hours logged per weekday across the range</p>
          </div>

          {/* Grid Chart */}
          <div className="flex-1 flex mt-8 relative">

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

        {/* Tag Averages Panel */}
        <div className="w-full lg:w-96 bg-card rounded-xl border border-border p-6 space-y-6">
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
