'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

interface EventResult {
  id: number;
  title: string;
  startDatetime: string;
  endDatetime: string;
  tag: string | null;
}

const PAGE_SIZE = 25;

/**
 * Global event search for the view headers. Debounced query against
 * /api/events/search; clicking a result jumps to that event's day and
 * opens it (via a ?event=<id> deep link read by the daily view).
 *
 * The results dropdown is rendered in a portal with fixed positioning so it
 * escapes the calendar's clipping/overflow containers and sits above the grid
 * — otherwise it gets clipped to a sliver and clicks/scrolls fall through to
 * the calendar behind it. More results page in as you scroll to the bottom.
 */
export default function EventSearch({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchPage = async (q: string, offset: number): Promise<EventResult[] | null> => {
    try {
      const res = await fetch(
        `/api/events/search?q=${encodeURIComponent(q)}&offset=${offset}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return (data.events || []) as EventResult[];
    } catch {
      return null;
    }
  };

  // Debounced initial fetch (offset 0) whenever the query changes.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) return;

    const timer = setTimeout(async () => {
      const events = await fetchPage(q, 0);
      if (events) {
        setResults(events);
        setHasMore(events.length === PAGE_SIZE);
        setHighlight(0);
        setOpen(true);
      }
      setLoading(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const onChange = (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      setResults([]);
      setHasMore(false);
      setOpen(false);
      setLoading(false);
    } else {
      setLoading(true);
      setOpen(true);
    }
  };

  // Append the next page when the list nears its bottom.
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const events = await fetchPage(query.trim(), results.length);
    if (events) {
      setResults((prev) => [...prev, ...events]);
      setHasMore(events.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      loadMore();
    }
  };

  // Track the anchor rect so the fixed dropdown stays under the input as the
  // page scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (containerRef.current) setRect(containerRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on outside click (input container and the portaled dropdown both count
  // as "inside").
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getColor = (tag: string | null) =>
    tag ? tags.find((t) => t.name === tag)?.color || '#6b7280' : '#6b7280';

  const formatWhen = (dt: string) => {
    const d = new Date(dt.replace(' ', 'T'));
    const date = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  };

  const goTo = (ev: EventResult) => {
    const dateStr = ev.startDatetime.slice(0, 10);
    setOpen(false);
    setQuery('');
    setResults([]);
    router.push(`/calendar/${dateStr}?event=${ev.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goTo(results[highlight]);
    }
  };

  const clear = () => {
    setQuery('');
    setResults([]);
    setHasMore(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  const dropdown =
    open && rect
      ? createPortal(
          <div
            ref={dropdownRef}
            onScroll={onListScroll}
            onWheel={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: rect.bottom + 8,
              right: Math.max(8, window.innerWidth - rect.right),
              width: 320,
              // Solid background so the grid never shows through, and keep any
              // overscroll from chaining to the calendar behind it.
              backgroundColor: 'var(--card)',
              overscrollBehavior: 'contain',
            }}
            className="max-h-96 overflow-y-auto border border-border rounded-lg shadow-2xl z-[100] py-1"
          >
            {loading && results.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">No events found</div>
            ) : (
              <>
                {results.map((ev, i) => (
                  <button
                    key={ev.id}
                    onClick={() => goTo(ev)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors ${
                      i === highlight ? 'bg-secondary' : ''
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getColor(ev.tag) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground truncate">
                        {ev.title}
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {formatWhen(ev.startDatetime)}
                        {ev.tag ? ` · ${ev.tag}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
                {loadingMore && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center">Loading more…</div>
                )}
              </>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-2.5 h-9 w-52 focus-within:ring-1 focus-within:ring-primary">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (results.length) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search events..."
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none w-full"
        />
        {query && (
          <button
            onClick={clear}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {dropdown}
    </div>
  );
}
