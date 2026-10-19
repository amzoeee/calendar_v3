'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, X } from 'lucide-react';
import { formatDuration, type Focus, type LifetimeEvents, type NameStats } from '@/lib/lifetime';
import { formatDateInputValue } from '@/lib/timezone';
import BulkEdit, { type BulkResult, type BulkTarget } from './BulkEdit';

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

interface LifetimePanelProps {
  data: LifetimeEvents;
  focus: Focus | null;
  // Parts of the focused title, offered as chips.
  parts: string[];
  stats: NameStats | null;
  pinned: boolean;
  colorOf: (tag: number) => string;
  onPart: (part: string | null) => void;
  onClear: () => void;
  bulkTarget: BulkTarget | null;
  tags: React.ComponentProps<typeof BulkEdit>['tags'];
  onBulkApplied: (result: BulkResult) => void;
}

const startOf = (data: LifetimeEvents, e: number) => new Date(data.starts[e] * MS_PER_MIN);

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fmtClock = (minuteOfDay: number) => {
  const d = new Date(2000, 0, 1, 0, minuteOfDay);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

function daysAgo(d: Date): string {
  const today = new Date();
  const n = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      MS_PER_DAY,
  );
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-secondary/40 border border-border rounded-lg p-2.5 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-base font-bold text-foreground tabular-nums mt-0.5 truncate">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function Sparkline({ monthly }: { monthly: NameStats['monthly'] }) {
  const max = Math.max(...monthly.map((m) => m.hours), 0.01);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        Hours per month
      </p>
      <div className="flex items-end gap-px h-12">
        {monthly.map((m) => (
          <div
            key={m.month.getTime()}
            title={`${m.month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}: ${m.hours.toFixed(1)}h`}
            className="flex-1 bg-primary/70 rounded-sm min-h-px"
            style={{ height: `${(m.hours / max) * 100}%`, opacity: m.hours > 0 ? 1 : 0.15 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{monthly[0]?.month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
        <span>now</span>
      </div>
    </div>
  );
}

export default function LifetimePanel({
  data,
  focus,
  parts,
  stats,
  pinned,
  colorOf,
  onPart,
  onClear,
  bulkTarget,
  tags,
  onBulkApplied,
}: LifetimePanelProps) {
  const focusKey = JSON.stringify(focus);
  const [menuOpen, setMenuOpen] = useState(false);
  // Tied to the selection it was opened for, so picking something else closes it.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = editingKey === focusKey;

  if (!focus) {
    return (
      <p className="text-sm text-muted-foreground">
        Hover or click an event to see others like it.
      </p>
    );
  }

  const heading =
    focus.kind === 'query'
      ? `“${focus.q}”`
      : focus.kind === 'part'
        ? focus.part
        : focus.part ?? data.titles[focus.title];
  const anchor = focus.kind === 'title' ? focus.event : null;
  const activePart = focus.kind === 'title' ? focus.part : null;

  const busiest = stats
    ? stats.weekdayCounts.indexOf(Math.max(...stats.weekdayCounts))
    : -1;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold tracking-tight break-words min-w-0">{heading}</h2>
          {pinned && (
            // Matches the heading's line height so the icons centre on its first line.
            <div className="relative flex items-center gap-0.5 h-7 shrink-0">
              {bulkTarget && (
                <>
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="More options"
                    aria-expanded={menuOpen}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 whitespace-nowrap z-50 bg-card border border-border rounded-lg shadow-2xl p-1">
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            setEditingKey(focusKey);
                          }}
                          className="w-full text-left px-3 py-2 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
                        >
                          Rename or retag…
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              <button
                onClick={onClear}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {anchor !== null && (
          <div className="text-xs text-muted-foreground space-y-1 mt-0.5">
            <p>
              {fmtDate(startOf(data, anchor))},{' '}
              {fmtClock(startOf(data, anchor).getHours() * 60 + startOf(data, anchor).getMinutes())} ·{' '}
              {formatDuration(data.durations[anchor])}
            </p>
            <Link
              href={`/calendar/${formatDateInputValue(startOf(data, anchor))}?event=${data.ids[anchor]}`}
              className="inline-block text-foreground underline underline-offset-2 hover:text-primary"
            >
              Open in daily view
            </Link>
          </div>
        )}
      </div>

      {parts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {parts.map((p) => (
            <button
              key={p}
              onClick={() => onPart(activePart === p ? null : p)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition cursor-pointer ${
                activePart === p
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-secondary border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {pinned && bulkTarget && editing && (
        <BulkEdit
          key={focusKey}
          target={bulkTarget}
          tags={tags}
          onApplied={onBulkApplied}
          onClose={() => setEditingKey(null)}
        />
      )}

      {!stats ? (
        <p className="text-sm text-muted-foreground">No matching events.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 xl:grid-cols-2 gap-2">
            <Fact label="Times" value={stats.count.toLocaleString()} />
            <Fact label="Total" value={formatDuration(stats.totalMin)} />
            <Fact
              label="Average"
              value={formatDuration(stats.avgMin)}
              hint={`median ${formatDuration(stats.medianMin)}`}
            />
            <Fact
              label="Longest"
              value={formatDuration(data.durations[stats.longestEvent])}
              hint={fmtDate(startOf(data, stats.longestEvent))}
            />
            <Fact label="First" value={fmtDate(startOf(data, stats.firstEvent))} />
            <Fact label="Last" value={daysAgo(startOf(data, stats.lastEvent))} hint={fmtDate(startOf(data, stats.lastEvent))} />
            <Fact
              label="Usually starts"
              value={stats.typicalStartMin === null ? 'anytime' : `~${fmtClock(stats.typicalStartMin)}`}
            />
            <Fact
              label="Busiest day"
              value={WEEKDAYS[busiest]}
              hint={`${stats.weekdayCounts[busiest]} time${stats.weekdayCounts[busiest] === 1 ? '' : 's'}`}
            />
            <Fact
              label="Longest streak"
              value={`${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}`}
            />
            <Fact
              label="Longest break"
              value={`${stats.longestGapDays} day${stats.longestGapDays === 1 ? '' : 's'}`}
            />
          </div>

          {stats.topTag && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colorOf(stats.topTag.tag) }}
              />
              {Math.round(stats.topTag.share * 100)}% of all your {data.tagNames[stats.topTag.tag]} time
            </p>
          )}

          <Sparkline monthly={stats.monthly} />

          {stats.related.count > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Also part of {stats.related.count} other event{stats.related.count === 1 ? '' : 's'} ·{' '}
                {formatDuration(stats.related.totalMin)}
              </p>
              <ul className="space-y-0.5 text-xs">
                {stats.related.titles.map(({ title, count }) => (
                  <li key={title} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">{data.titles[title]}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
