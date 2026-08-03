'use client';

import React, { useState, useEffect, useRef } from 'react';
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

/**
 * Global event search for the view headers. Debounced query against
 * /api/events/search; clicking a result jumps to that event's day and
 * opens it (via a ?event=<id> deep link read by the daily view).
 */
export default function EventSearch({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced fetch. State resets for the empty-query case happen in the
  // change handler; this effect only performs the (async) fetch.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.events || []);
          setHighlight(0);
          setOpen(true);
        }
      } catch {
        // network hiccup — leave existing results
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const onChange = (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      setResults([]);
      setOpen(false);
      setLoading(false);
    } else {
      setLoading(true);
      setOpen(true);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
    setOpen(false);
    inputRef.current?.focus();
  };

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

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-lg shadow-2xl z-50 py-1">
          {loading && results.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">No events found</div>
          ) : (
            results.map((ev, i) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
