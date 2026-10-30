'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ListChecks, Search, X } from 'lucide-react';
import TagSelect from '@/app/components/TagSelect';
import { listPendingEventsAction, retagPendingEventsAction, restoreEventsAction, type EventSnapshot } from '@/app/actions';
import { pacificDbStringToDate } from '@/lib/timezone';
import Button from '@/app/components/Button';

type Data = Awaited<ReturnType<typeof listPendingEventsAction>>;
type Filter = 'all' | 'untagged' | 'selected';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'untagged', label: 'Untagged' },
  { value: 'selected', label: 'Selected' },
];

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-400/40 text-inherit rounded-sm">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

/** Review button for the pending banner, and the panel it opens for bulk-tagging staged events. */
export default function PendingReview() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; previous?: EventSnapshot[] } | null>(null);
  const anchor = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async () => setData(await listPendingEventsAction());

  const openPanel = () => {
    setOpen(true);
    setData(null);
    setSelected(new Set());
    setQuery('');
    setFilter('all');
    setNotice(null);
    load();
  };

  useEffect(() => {
    if (!open) return;
    // Skipped on touch, where focusing opens the keyboard over the list.
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const rows = useMemo(
    () =>
      (data?.events ?? []).map((ev) => {
        const start = pacificDbStringToDate(ev.startDatetime);
        return {
          ...ev,
          day: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          time: start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        };
      }),
    [data],
  );
  const tagColors = useMemo(() => new Map((data?.tags ?? []).map((t) => [t.name, t.color])), [data]);

  const q = query.trim();
  const matches = (title: string) => !q || title.toLowerCase().includes(q.toLowerCase());
  const visible = rows.filter(
    (r) => filter === 'all' || (filter === 'untagged' ? !r.tag : selected.has(r.id)),
  );
  const unselectedMatches = rows.filter((r) => matches(r.title) && !selected.has(r.id));
  const untaggedCount = rows.filter((r) => !r.tag).length;

  const selectMatches = () => {
    if (!unselectedMatches.length) return;
    setSelected((s) => new Set([...s, ...unselectedMatches.map((r) => r.id)]));
  };

  const toggle = (id: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      const ids = visible.map((r) => r.id);
      const from = anchor.current === null ? -1 : ids.indexOf(anchor.current);
      const to = ids.indexOf(id);
      const range = shift && from >= 0 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
      for (const r of range) {
        if (on) next.add(r);
        else next.delete(r);
      }
      return next;
    });
    anchor.current = id;
  };

  const apply = async () => {
    if (!selected.size) {
      setNotice({ text: 'Select some events first.' });
      return;
    }
    setBusy(true);
    try {
      const res = await retagPendingEventsAction([...selected], tag || null);
      if ('error' in res) {
        setNotice({ text: res.error ?? 'Something went wrong.' });
        return;
      }
      const n = res.previous.length;
      setNotice({
        text: `Tagged ${n} event${n === 1 ? '' : 's'} ${tag ? `“${tag}”` : 'with no tag'}`,
        previous: res.previous,
      });
      setSelected(new Set());
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!notice?.previous) return;
    setBusy(true);
    try {
      await restoreEventsAction(notice.previous);
      setNotice(null);
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <div className="fixed inset-0 z-[90] flex md:justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review import"
        className="relative mt-12 md:mt-0 w-full md:max-w-md flex flex-col bg-card border-t md:border-t-0 md:border-l border-border rounded-t-xl md:rounded-none shadow-2xl min-h-0"
      >
        <div className="p-4 space-y-3 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">Review import</h2>
            <div className="flex items-center gap-3">
              {data && (
                <span className="text-xs text-muted-foreground">
                  {rows.length} staged · {untaggedCount} untagged
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    selectMatches();
                  }
                }}
                placeholder="Search titles"
                className="w-full rounded bg-secondary border border-border pl-8 pr-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              onClick={selectMatches}
              className="px-3 py-1.5 rounded border border-border text-xs font-semibold text-foreground hover:bg-secondary whitespace-nowrap cursor-pointer"
            >
              {!unselectedMatches.length
                ? q ? 'All matches selected' : 'All selected'
                : q
                  ? `Select ${unselectedMatches.length} match${unselectedMatches.length === 1 ? '' : 'es'}`
                  : 'Select all'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={`px-2.5 py-0.5 rounded-full border text-xs cursor-pointer transition ${
                  filter === f.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="flex-1" />
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!data ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : !visible.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              {filter === 'selected' ? 'Nothing selected.' : filter === 'untagged' ? 'Everything has a tag.' : 'No staged events.'}
            </p>
          ) : (
            visible.map((r, i) => {
              const header = i === 0 || visible[i - 1].day !== r.day ? r.day : null;
              const isSelected = selected.has(r.id);
              const color = r.tag ? tagColors.get(r.tag) : undefined;
              return (
                <React.Fragment key={r.id}>
                  {header && (
                    <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase text-muted-foreground">{header}</div>
                  )}
                  <button
                    onClick={(e) => toggle(r.id, e.shiftKey)}
                    aria-pressed={isSelected}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm border-t border-border/50 cursor-pointer select-none transition ${
                      isSelected ? 'bg-primary/15' : 'hover:bg-secondary/60'
                    } ${q && !matches(r.title) ? 'text-muted-foreground/60' : 'text-foreground'}`}
                  >
                    <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} className="pointer-events-none accent-primary" />
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{r.time}</span>
                    <span className="flex-1 min-w-0 truncate">
                      <Highlight text={r.title} query={q} />
                    </span>
                    {r.tag ? (
                      <span className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        {r.tag}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs italic text-muted-foreground/70">untagged</span>
                    )}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-border space-y-2 bg-secondary/30">
          {notice && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1">{notice.text}</span>
              {notice.previous && notice.previous.length > 0 && (
                <button onClick={undo} disabled={busy} className="font-semibold text-foreground hover:underline cursor-pointer disabled:opacity-50">
                  Undo
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground shrink-0">
              {selected.size ? `${selected.size} selected` : 'None selected'}
            </span>
            <div className="flex-1 min-w-0">
              <TagSelect tags={data?.tags ?? []} value={tag} onChange={setTag} />
            </div>
            <Button
              onClick={apply}
              disabled={busy}
              variant="primary"
              size="none"
              className="px-3 py-2 rounded text-xs font-bold whitespace-nowrap"
            >
              Apply tag
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-muted text-foreground border border-border rounded text-xs font-semibold shadow transition cursor-pointer"
      >
        <ListChecks className="h-3.5 w-3.5" />
        Review
      </button>
      {open && createPortal(panel, document.body)}
    </>
  );
}
