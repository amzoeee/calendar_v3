'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

interface StatsClientProps {
  date: string;
  sundayDate: string;
  weekdaysOnly: boolean;
  tagHoursByDay: Record<string, Record<string, number>>;
  tags: Tag[];
}

export default function StatsClient({
  date,
  sundayDate,
  weekdaysOnly,
  tagHoursByDay,
  tags,
}: StatsClientProps) {
  const router = useRouter();

  // Navigation dates
  const prevWeekStr = new Date(new Date(sundayDate + 'T00:00:00').getTime() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const nextWeekStr = new Date(new Date(sundayDate + 'T00:00:00').getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');

  const weekDates: Date[] = [];
  const sun = new Date(sundayDate + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    weekDates.push(new Date(sun.getTime() + i * 24 * 60 * 60 * 1000));
  }

  const weekStartStr = weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndStr = weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Filter dates if weekdaysOnly is active (Saturday = 6, Sunday = 0)
  const activeDates = weekDates.filter((d) => {
    if (weekdaysOnly) {
      const w = d.getDay();
      return w !== 0 && w !== 6;
    }
    return true;
  });

  // Calculate totals and peak scale
  let maxTotalHours = 0;
  const dayStats = weekDates.map((day) => {
    const dateStr = day.toLocaleDateString('en-CA');
    const hours = tagHoursByDay[dateStr] || {};
    const total = Object.values(hours).reduce((a, b) => a + b, 0);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

    if (!weekdaysOnly || !isWeekend) {
      maxTotalHours = Math.max(maxTotalHours, total);
    }

    return {
      dateStr,
      dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
      dayDisplay: day.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      hours,
      total,
      isWeekend,
    };
  });

  const maxScale = Math.max(8, Math.ceil(maxTotalHours) + 1);

  // Gather all unique tags present in the logs
  const allTagsSet = new Set<string>();
  dayStats.forEach((d) => {
    if (!weekdaysOnly || !d.isWeekend) {
      Object.keys(d.hours).forEach((t) => allTagsSet.add(t));
    }
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

  // Calculate averages per tag across active days (excluding days with 0 hours logged)
  const activeDaysWithData = dayStats.filter((d) => (!weekdaysOnly || !d.isWeekend) && d.total > 0).length;

  const tagAverages: Record<string, number> = {};
  allTags.forEach((tag) => {
    const totalHours = dayStats
      .filter((d) => !weekdaysOnly || !d.isWeekend)
      .reduce((sum, d) => sum + (d.hours[tag] || 0), 0);
    tagAverages[tag] = activeDaysWithData > 0 ? totalHours / activeDaysWithData : 0;
  });

  const getTagColor = (tagName: string) => {
    if (tagName === 'Untagged') return '#6b7280';
    return tags.find((t) => t.name === tagName)?.color || '#6b7280';
  };

  const handleToggleWeekdays = () => {
    const nextVal = !weekdaysOnly;
    router.push(`/stats/${date}?weekdays_only=${nextVal}`);
  };

  // Keyboard arrow navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      if (!isInput && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          router.push(`/stats/${prevWeekStr}?weekdays_only=${weekdaysOnly}`);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          router.push(`/stats/${nextWeekStr}?weekdays_only=${weekdaysOnly}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [router, prevWeekStr, nextWeekStr, weekdaysOnly]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      
      {/* Header controls */}
      <div className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 glass-panel">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/stats/${prevWeekStr}?weekdays_only=${weekdaysOnly}`)}
            className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => {
              const today = new Date().toLocaleDateString('en-CA');
              router.push(`/stats/${today}?weekdays_only=${weekdaysOnly}`);
            }}
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => router.push(`/stats/${nextWeekStr}?weekdays_only=${weekdaysOnly}`)}
            className="p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <h1 className="text-xl font-bold tracking-tight">
          Stats: {weekStartStr} – {weekEndStr}
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
        </div>
      </div>

      {/* Main Page Area */}
      <div className="flex-1 p-8 overflow-y-auto flex flex-col lg:flex-row gap-8">
        
        {/* Stacked Bar Chart */}
        <div className="flex-1 bg-card rounded-xl border border-border p-6 flex flex-col justify-between min-h-[400px]">
          <div>
            <h2 className="text-lg font-bold">Time Breakdown per Day</h2>
            <p className="text-xs text-muted-foreground mt-1">Stacked hours logged on each day of the week</p>
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

            {/* Bars Column (matching weekdays filter) */}
            <div className="absolute left-10 right-0 top-0 bottom-8 flex justify-around items-end">
              {dayStats
                .filter((d) => !weekdaysOnly || !d.isWeekend)
                .map((day, idx) => (
                  <div key={idx} className="w-16 h-full flex flex-col justify-end group/bar relative">
                    
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
                            <div className="absolute opacity-0 group-hover/segment:opacity-100 bg-black text-white text-[9px] font-semibold p-1.5 rounded pointer-events-none z-30 transition-all shadow-xl -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap border border-border">
                              {tag}: {hrs.toFixed(1)} hrs
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Total label above bar */}
                    {day.total > 0 && (
                      <span className="absolute left-1/2 -translate-x-1/2 text-[9px] font-extrabold text-foreground pb-1" style={{ bottom: `${(day.total / maxScale) * 100}%` }}>
                        {day.total.toFixed(1)}h
                      </span>
                    )}

                    {/* Day label below bar */}
                    <div className="absolute bottom-[-24px] left-0 right-0 text-center select-none">
                      <p className="text-[10px] font-bold text-foreground">{day.dayName}</p>
                      <p className="text-[9px] text-muted-foreground">{day.dayDisplay}</p>
                    </div>
                  </div>
                ))}
            </div>

          </div>
        </div>

        {/* Tag Averages Panel */}
        <div className="w-full lg:w-96 bg-card rounded-xl border border-border p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold">Daily Averages</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Average hours logged per tag (based on {activeDaysWithData} active days)
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
                <p className="text-sm text-muted-foreground">No events logged this week.</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
