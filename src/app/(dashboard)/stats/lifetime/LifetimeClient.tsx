'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  buildMatchIndex,
  buildSegments,
  columnOfDate,
  computeStats,
  EXACT,
  formatDuration,
  matchEvents,
  rangeColumns,
  rangeSearch,
  sliceEvents,
  todayColumn,
  type Focus,
  type LifetimeEvents,
  type LifetimeRange,
} from '@/lib/lifetime';
import StatsViewSwitch from '@/app/components/StatsViewSwitch';
import type { WeekStart } from '@/lib/week';
import LifetimeChart from './LifetimeChart';
import LifetimePanel from './LifetimePanel';
import LifetimeSearch from './LifetimeSearch';
import RangePicker from './RangePicker';
import type { BulkResult, BulkTarget } from './BulkEdit';
import { restoreEventsAction } from '@/app/actions';
import { useUndo } from '@/app/components/UndoToast';
import { normalizeTitle } from '@/lib/titleParts';
import { track } from '@/lib/track';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  scope: string;
  parentId: number | null;
}

interface LifetimeClientProps {
  data: LifetimeEvents;
  tags: Tag[];
  todayStr: string;
  weekStart: WeekStart;
  initialRange: LifetimeRange;
}

const UNTAGGED_COLOR = '#6b7280';
// How long the pointer rests on an event before its matches light up.
const DWELL_MS = 600;
const MS_PER_MIN = 60_000;

const noopSubscribe = () => () => {};

export default function LifetimeClient({ data: allData, tags, todayStr, weekStart, initialRange }: LifetimeClientProps) {
  // Columns and times depend on the browser's timezone, so the chart only
  // renders on the client.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // ---- Range ---------------------------------------------------------------
  const [range, setRange] = useState(initialRange);
  const hasEvents = allData.starts.length > 0;
  const allSegments = useMemo(() => buildSegments(allData), [allData]);
  const { firstDay, lastDay } = rangeColumns(
    range,
    hasEvents ? allSegments.eventDay[0] : 0,
    hydrated ? todayColumn() : columnOfDate(todayStr),
  );
  // Everything below sees only the range. Until hydration the columns are in
  // the server's timezone, so it gets every event.
  const data = useMemo(
    () => (hydrated && range.kind !== 'all' ? sliceEvents(allData, allSegments.eventDay, firstDay, lastDay) : allData),
    [hydrated, range.kind, allData, allSegments, firstDay, lastDay],
  );

  const segments = useMemo(() => buildSegments(data), [data]);
  const index = useMemo(() => buildMatchIndex(data), [data]);
  const counts = useMemo(() => index.eventsByTitle.map((es) => es.length), [index]);
  // Parts found outside a title of their own, so searchable on their own.
  const searchParts = useMemo(() => {
    const list: { part: string; count: number }[] = [];
    index.titlesByPart.forEach((ts, part) => {
      const count = ts.reduce((n, t) => n + index.eventsByTitle[t].length, 0);
      if (count > 0 && !ts.every((t) => index.keys[t] === part)) list.push({ part, count });
    });
    return list;
  }, [index]);

  const tagColors = useMemo(
    () => data.tagNames.map((n) => tags.find((t) => t.name === n)?.color ?? UNTAGGED_COLOR),
    [data, tags],
  );
  const tagCounts = useMemo(() => {
    const perTag = new Map<number, number>();
    data.tagIdx.forEach((g) => perTag.set(g, (perTag.get(g) ?? 0) + 1));
    return perTag;
  }, [data]);
  // Subtags with events, by index into data.tagNames.
  const tagSubtags = useMemo(
    () =>
      data.tagNames.map((n) => {
        const tag = tags.find((t) => t.name === n);
        if (!tag) return [];
        return tags
          .filter((t) => t.parentId === tag.id)
          .map((t) => data.tagNames.indexOf(t.name))
          .filter((s) => tagCounts.has(s));
      }),
    [data, tags, tagCounts],
  );
  const searchTags = useMemo(
    () =>
      tagSubtags
        .map((subs, g) => ({ tag: g, count: [g, ...subs].reduce((n, m) => n + (tagCounts.get(m) ?? 0), 0) }))
        .filter((t) => t.count > 0),
    [tagSubtags, tagCounts],
  );

  const colorOf = useCallback(
    (g: number) => (g >= 0 ? tagColors[g] : UNTAGGED_COLOR),
    [tagColors],
  );

  const tagTotalMin = useMemo(() => {
    const totals = new Map<number, number>();
    data.tagIdx.forEach((g, e) => totals.set(g, (totals.get(g) ?? 0) + data.durations[e]));
    return totals;
  }, [data]);

  // Legend entries: tags in their usual order, then untagged.
  const legend = useMemo(
    () =>
      [...tagTotalMin.keys()].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b)),
    [tagTotalMin],
  );
  const [hiddenTags, setHiddenTags] = useState<Set<number>>(() => new Set());
  const toggleTag = (g: number) =>
    setHiddenTags((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  // ---- Hover, dwell and pinning ------------------------------------------
  const [hover, setHover] = useState<{ event: number; x: number; y: number } | null>(null);
  const [dwell, setDwell] = useState<number | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [query, setQuery] = useState('');
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEvent = useRef<number | null>(null);

  const onHover = useCallback((event: number | null, x: number, y: number) => {
    setHover(event === null ? null : { event, x, y });
    if (event === hoverEvent.current) return;
    hoverEvent.current = event;
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    // Crossing the gap between bars keeps the last dwell; leaving the chart
    // (reported as null with no event under it) is handled by onLeave.
    if (event !== null) dwellTimer.current = setTimeout(() => setDwell(event), DWELL_MS);
  }, []);

  const onLeave = () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    hoverEvent.current = null;
    setHover(null);
    setDwell(null);
  };

  useEffect(() => () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
  }, []);

  const clearFocus = useCallback(() => {
    setPinned(null);
    setDwell(null);
    setQuery('');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearFocus]);

  const onSelect = (event: number | null) => {
    setQuery('');
    setPinned(
      event === null ? null : { kind: 'title', title: data.titleIdx[event], part: null, event },
    );
  };

  const dwellFocus = useMemo<Focus | null>(
    () => (dwell === null ? null : { kind: 'title', title: data.titleIdx[dwell], part: null, event: dwell }),
    [data, dwell],
  );
  const focus = pinned ?? dwellFocus;

  const eventLevels = useMemo(() => (focus ? matchEvents(data, index, focus) : null), [data, index, focus]);
  const stats = useMemo(
    () => (hydrated && eventLevels ? computeStats(data, segments, eventLevels, tagTotalMin, weekStart, firstDay, lastDay) : null),
    [hydrated, data, segments, eventLevels, tagTotalMin, weekStart, firstDay, lastDay],
  );

  // Chips only help when the title splits into something other than itself.
  const parts =
    focus?.kind === 'title'
      ? index.parts[focus.title].length > 1 ||
        (index.parts[focus.title].length === 1 && index.parts[focus.title][0] !== index.keys[focus.title])
        ? index.parts[focus.title]
        : []
      : [];

  // The events a rename or retag would touch, split by match level. A tag
  // spans unrelated titles, so there's nothing to rename.
  const bulkTarget = useMemo<BulkTarget | null>(() => {
    if (!focus || !eventLevels || focus.kind === 'tag') return null;
    const exactIds: number[] = [];
    const relatedIds: number[] = [];
    eventLevels.forEach((lvl, e) => {
      if (lvl) (lvl === EXACT ? exactIds : relatedIds).push(data.ids[e]);
    });
    if (focus.kind === 'query') {
      const q = normalizeTitle(focus.q);
      return { label: q, exactIds, relatedIds, renameFrom: q, renameMode: 'substring' };
    }
    if (focus.kind === 'part') {
      return { label: focus.part, exactIds, relatedIds, renameFrom: focus.part, renameMode: 'word' };
    }
    const ps = index.parts[focus.title];
    const from = focus.part ?? (ps.length === 1 ? ps[0] : null);
    return { label: from ?? data.titles[focus.title], exactIds, relatedIds, renameFrom: from, renameMode: 'word' };
  }, [focus, eventLevels, index, data]);

  const { raiseUndo } = useUndo();

  // Title indices shift once the page reloads with the edit, so the pin
  // becomes a search for the new name instead.
  const onBulkApplied = ({ newName, renamed, retagged, previous }: BulkResult) => {
    setDwell(null);
    if (newName) {
      setQuery(newName);
      setPinned({ kind: 'query', q: newName });
    } else {
      clearFocus();
    }
    const n = (k: number) => `${k.toLocaleString()} event${k === 1 ? '' : 's'}`;
    const message =
      renamed && retagged
        ? `Renamed ${n(renamed)}, retagged ${n(retagged)}`
        : renamed
          ? `Renamed ${n(renamed)}`
          : retagged
            ? `Retagged ${n(retagged)}`
            : 'Nothing needed changing';
    raiseUndo({
      message,
      undo: previous.length
        ? async () => {
            await restoreEventsAction(previous);
            clearFocus();
          }
        : null,
    });
  };

  const onPart = (part: string | null) => {
    if (focus?.kind === 'title') setPinned({ ...focus, part });
  };

  const onSubtags = (withSubtags: boolean) => {
    if (focus?.kind === 'tag') setPinned({ ...focus, withSubtags });
  };

  const changeRange = (next: LifetimeRange) => {
    track('lifetime.range', { range: next.kind });
    setRange(next);
    window.history.replaceState(null, '', `${window.location.pathname}${rangeSearch(next)}`);
    // Event indices shift with the range.
    hoverEvent.current = null;
    setHover(null);
    setDwell(null);
    setPinned((p) => (p?.kind === 'title' && p.event !== null ? { ...p, event: null } : p));
  };

  const totalMin = useMemo(() => data.durations.reduce((a, b) => a + b, 0), [data]);
  const sinceLabel =
    hydrated && hasEvents && range.kind === 'all'
      ? new Date(data.starts[0] * MS_PER_MIN).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

  const tip = hover && hydrated ? hover : null;
  const tipStart = tip ? new Date(data.starts[tip.event] * MS_PER_MIN) : null;
  const tipEnd = tip ? new Date((data.starts[tip.event] + data.durations[tip.event]) * MS_PER_MIN) : null;
  const tipTag = tip ? data.tagIdx[tip.event] : -1;
  const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="border-b border-border px-3 md:px-6 py-3 shrink-0 glass-panel">
        <div className="flex items-center justify-between gap-2 md:gap-4">
          <div className="min-w-0">
            <h1 className="text-sm md:text-xl font-bold tracking-tight truncate">Lifetime</h1>
            {hydrated && hasEvents && (
              <p className="hidden md:block text-xs text-muted-foreground">
                {data.starts.length.toLocaleString()} events · {formatDuration(totalMin)}
                {sinceLabel ? ` since ${sinceLabel}` : range.kind === 'year' ? ' this year' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <LifetimeSearch
              titles={data.titles}
              keys={index.keys}
              counts={counts}
              parts={searchParts}
              tags={searchTags}
              tagNames={data.tagNames}
              colorOf={colorOf}
              query={query}
              onQuery={(q) => {
                setQuery(q);
                setPinned(q.trim() ? { kind: 'query', q } : null);
              }}
              onPick={(t) => {
                setQuery(data.titles[t]);
                setPinned({ kind: 'title', title: t, part: null, event: null });
              }}
              onPickPart={(part) => {
                setQuery(part);
                setPinned({ kind: 'part', part });
              }}
              onPickTag={(tag) => {
                setQuery(data.tagNames[tag]);
                setPinned({ kind: 'tag', tag, subtags: tagSubtags[tag], withSubtags: true });
              }}
            />
            <StatsViewSwitch active="lifetime" rangeHref={`/stats/${todayStr}`} />
          </div>
        </div>
        {hasEvents && (
          <div className="mt-2">
            <RangePicker range={range} firstDay={firstDay} lastDay={lastDay} onChange={changeRange} />
          </div>
        )}
      </div>

      {!hasEvents ? (
        <p className="p-8 text-sm text-muted-foreground">No events logged yet.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto xl:overflow-hidden flex flex-col xl:flex-row gap-4 p-4 md:p-6">
          <section className="bg-card rounded-xl border border-border p-3 md:p-4 flex flex-col xl:flex-1 xl:min-h-0 min-w-0">
            <div className="h-[420px] md:h-[520px] xl:h-auto xl:flex-1 xl:min-h-0" onPointerLeave={onLeave}>
              {hydrated && (
                <LifetimeChart
                  // Remount so its zoom resets to the new range.
                  key={`${firstDay}:${lastDay}`}
                  data={data}
                  segments={segments}
                  firstDay={firstDay}
                  lastDay={lastDay}
                  tagColors={tagColors}
                  untaggedColor={UNTAGGED_COLOR}
                  hiddenTags={hiddenTags}
                  eventLevels={eventLevels}
                  hovered={hover?.event ?? null}
                  pinned={pinned?.kind === 'title' ? pinned.event : null}
                  onHover={onHover}
                  onSelect={onSelect}
                />
              )}
            </div>
            <div className="hidden md:flex flex-wrap gap-1.5 mt-3">
              {legend.map((g) => (
                <button
                  key={g}
                  onClick={() => toggleTag(g)}
                  aria-pressed={!hiddenTags.has(g)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-md border border-border bg-secondary transition cursor-pointer ${
                    hiddenTags.has(g) ? 'opacity-40 line-through' : 'hover:bg-muted'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorOf(g) }} />
                  {g >= 0 ? data.tagNames[g] : 'Untagged'}
                </button>
              ))}
            </div>
          </section>

          <aside className="bg-card rounded-xl border border-border p-4 xl:w-80 shrink-0 xl:overflow-y-auto">
            <LifetimePanel
              data={data}
              focus={focus}
              parts={parts}
              stats={stats}
              pinned={pinned !== null}
              colorOf={colorOf}
              onPart={onPart}
              onSubtags={onSubtags}
              onClear={clearFocus}
              bulkTarget={bulkTarget}
              tags={tags}
              onBulkApplied={onBulkApplied}
            />
          </aside>
        </div>
      )}

      {tip && tipStart && tipEnd && (
        <div
          className="fixed z-[100] pointer-events-none bg-card border border-border rounded-lg shadow-2xl px-3 py-2 text-xs max-w-64"
          style={{
            left: tip.x + 14 + 256 > window.innerWidth ? tip.x - 14 - 256 : tip.x + 14,
            top: tip.y + 14,
          }}
        >
          <p className="font-semibold text-sm text-foreground break-words">{data.titles[data.titleIdx[tip.event]]}</p>
          <p className="flex items-center gap-1.5 text-muted-foreground mt-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorOf(tipTag) }} />
            {tipTag >= 0 ? data.tagNames[tipTag] : 'Untagged'}
          </p>
          <p className="text-muted-foreground mt-1">
            {tipStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
          <p className="text-muted-foreground">
            {clock(tipStart)} – {clock(tipEnd)} · {formatDuration(data.durations[tip.event])}
          </p>
        </div>
      )}
    </div>
  );
}
