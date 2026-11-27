'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import CalendarMonth from '@/app/components/CalendarMonth';
import Overlay from '@/app/components/Overlay';
import { track } from '@/lib/track';
import { defaultDay, groupTagHours, HOURS_MODE_COOKIE, type HoursMode } from '@/lib/tagHours';
import type { WeekStart } from '@/lib/week';

interface Tag {
  id: number;
  name: string;
  color: string;
  parentId: number | null;
}

interface TagHoursPanelProps {
  /** The days shown on the page, in order. */
  days: { dateStr: string; hours: Record<string, number> }[];
  averages: Record<string, number>;
  activeDays: number;
  rangeLen: number;
  panel: HoursPanelState;
  weekStart: WeekStart;
  tags: Tag[];
  getTagColor: (name: string) => string;
}

// Back/forward reuses the page's first render, so its initialMode can be stale.
let lastMode: HoursMode | undefined;

function saveMode(mode: HoursMode) {
  lastMode = mode;
  document.cookie = `${HOURS_MODE_COOKIE}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
}

export type HoursPanelState = ReturnType<typeof useHoursPanel>;

/** Mode and day for the panel, held by the page so its charts can open a day too. */
export function useHoursPanel(initialMode: HoursMode, dayStrs: string[], today: string) {
  const [mode, setMode] = useState(() => lastMode ?? initialMode);
  const [picked, setPicked] = useState<string | null>(null);

  const changeMode = (next: HoursMode, source: 'toggle' | 'bar' = 'toggle') => {
    if (next === mode) return;
    setMode(next);
    saveMode(next);
    track('stats.hours_mode', { mode: next, source });
  };

  const day = picked && dayStrs.includes(picked) ? picked : defaultDay(dayStrs, today);
  return { mode, changeMode, day, setDay: setPicked };
}

export default function TagHoursPanel({
  days,
  averages,
  activeDays,
  rangeLen,
  panel,
  weekStart,
  tags,
  getTagColor,
}: TagHoursPanelProps) {
  const { mode, changeMode, day, setDay: setPicked } = panel;
  // Where the day picker opens: under the date on desktop, a sheet on phones.
  const [pickerAt, setPickerAt] = useState<DOMRect | 'sheet' | null>(null);

  const isDay = mode === 'day';
  const dayStrs = days.map((d) => d.dateStr);
  const index = day === undefined ? -1 : dayStrs.indexOf(day);
  const prevDay = dayStrs[index - 1];
  const nextDay = index === -1 ? undefined : dayStrs[index + 1];

  const openPicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    const wide = window.matchMedia('(min-width: 768px)').matches;
    setPickerAt(wide ? e.currentTarget.getBoundingClientRect() : 'sheet');
  };
  const pickDay = (d: string) => {
    setPicked(d);
    setPickerAt(null);
  };
  const calendar = (size: 'sm' | 'lg') => (
    <CalendarMonth
      selected={day ?? null}
      onSelect={pickDay}
      weekStart={weekStart}
      size={size}
      isDisabled={(d) => !dayStrs.includes(d)}
    />
  );

  const hours = isDay ? (days[index]?.hours ?? {}) : averages;
  const groups = groupTagHours(hours, tags);
  const format = (h: number) => `${h.toFixed(1)}h${isDay ? '' : ' / day'}`;

  const modes: { key: HoursMode; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'range', label: rangeLen === 7 ? 'Week' : 'Range' },
  ];

  const stepButton = (target: string | undefined, label: string, Icon: typeof ChevronLeft) => (
    <button
      type="button"
      onClick={() => target && setPicked(target)}
      disabled={!target}
      aria-label={label}
      className="p-1.5 rounded-lg bg-secondary hover:bg-muted text-foreground transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    // `lg:self-start` lets it grow with its rows; the 400px floor matches the
    // chart so a short list lines up with it.
    <div
      id="tag-hours-panel"
      className="w-full lg:self-start lg:min-h-[400px] lg:w-96 bg-card rounded-xl border border-border p-4 md:p-6 space-y-6 scroll-mt-4"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{isDay ? 'Event Hours' : 'Event Averages'}</h2>
          <div className="flex items-center gap-0.5 p-0.5 bg-secondary border border-border rounded-lg shrink-0">
            {modes.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => changeMode(key)}
                aria-pressed={mode === key}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                  mode === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {isDay ? (
          day !== undefined && (
            <div className="flex items-center justify-between gap-2 mt-3">
              {stepButton(prevDay, 'Previous day', ChevronLeft)}
              <button
                type="button"
                onClick={openPicker}
                aria-haspopup="dialog"
                aria-label="Pick a day"
                className="px-2 py-1 rounded-lg text-sm font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                {new Date(day + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </button>
              {stepButton(nextDay, 'Next day', ChevronRight)}
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground mt-1">
            Average event hours per tag (based on {activeDays} day
            {activeDays === 1 ? '' : 's'} with events)
          </p>
        )}
      </div>

      <div className="space-y-3">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.root} className="space-y-1.5">
              {group.hasSubtags && (
                <div className="flex items-center justify-between p-3 bg-secondary/60 rounded-lg border border-border">
                  <div className="flex items-center gap-3 truncate">
                    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: getTagColor(group.root) }}></span>
                    <span className="text-sm font-bold truncate text-foreground">{group.root} (total)</span>
                  </div>
                  <span className="text-sm font-extrabold text-primary shrink-0">{format(group.total)}</span>
                </div>
              )}
              {group.members.map((name) => (
                <div
                  key={name}
                  className={`flex items-center justify-between p-3 bg-secondary/35 rounded-lg border border-border/40 ${
                    group.hasSubtags ? 'ml-6' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: getTagColor(name) }}></span>
                    <span className="text-sm font-semibold truncate text-foreground">{name}</span>
                  </div>
                  <span className="text-sm font-extrabold text-primary shrink-0">{format(hours[name])}</span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted-foreground">
              {isDay && day !== undefined ? 'No events logged this day.' : 'No events logged in this range.'}
            </p>
          </div>
        )}
      </div>

      {pickerAt === 'sheet' && (
        <Overlay
          variant="sheet"
          onClose={() => setPickerAt(null)}
          aria-label="Pick a day"
          className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight">Pick a day</h2>
            <button
              type="button"
              onClick={() => setPickerAt(null)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div>{calendar('lg')}</div>
        </Overlay>
      )}
      {pickerAt instanceof DOMRect && (
        <Overlay
          variant="none"
          onClose={() => setPickerAt(null)}
          backdropClassName=""
          aria-label="Pick a day"
          style={{
            left: Math.max(8, Math.min(pickerAt.left + pickerAt.width / 2 - 120, window.innerWidth - 248)),
            ...(window.innerHeight - pickerAt.bottom < 300
              ? { bottom: window.innerHeight - pickerAt.top + 4 }
              : { top: pickerAt.bottom + 4 }),
          }}
          className="fixed w-60 bg-card border border-border rounded-lg shadow-2xl p-3"
        >
          {calendar('sm')}
        </Overlay>
      )}
    </div>
  );
}
