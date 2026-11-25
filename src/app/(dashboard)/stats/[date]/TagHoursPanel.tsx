'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { track } from '@/lib/track';
import { defaultDay, groupTagHours, HOURS_MODE_COOKIE, type HoursMode } from '@/lib/tagHours';

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
  today: string;
  initialMode: HoursMode;
  tags: Tag[];
  getTagColor: (name: string) => string;
}

function saveMode(mode: HoursMode) {
  document.cookie = `${HOURS_MODE_COOKIE}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
}

export default function TagHoursPanel({
  days,
  averages,
  activeDays,
  rangeLen,
  today,
  initialMode,
  tags,
  getTagColor,
}: TagHoursPanelProps) {
  const [mode, setMode] = useState(initialMode);
  const [picked, setPicked] = useState<string | null>(null);

  const changeMode = (next: HoursMode) => {
    if (next === mode) return;
    setMode(next);
    saveMode(next);
    track('stats.hours_mode', { mode: next });
  };

  const isDay = mode === 'day';
  const dayStrs = days.map((d) => d.dateStr);
  const day = picked && dayStrs.includes(picked) ? picked : defaultDay(dayStrs, today);
  const index = day === undefined ? -1 : dayStrs.indexOf(day);
  const prevDay = dayStrs[index - 1];
  const nextDay = index === -1 ? undefined : dayStrs[index + 1];

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
    <div className="w-full lg:self-start lg:min-h-[400px] lg:w-96 bg-card rounded-xl border border-border p-4 md:p-6 space-y-6">
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
              <span className="text-sm font-semibold text-foreground">
                {new Date(day + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
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
    </div>
  );
}
