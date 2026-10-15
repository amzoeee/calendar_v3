'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '@/lib/track';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { normalizeTitle } from '@/lib/titleParts';

const MAX_SUGGESTIONS = 30;

interface LifetimeSearchProps {
  titles: string[];
  keys: string[];
  counts: number[];
  query: string;
  // Fires on every keystroke, so the chart highlights as you type.
  onQuery: (q: string) => void;
  // The parent sets the box to the picked title.
  onPick: (title: number) => void;
}

/**
 * Same look as EventSearch, but it filters the already-loaded titles instead
 * of querying the server: the first row keeps the typed text as a search,
 * the rest pick one title.
 */
export default function LifetimeSearch({ titles, keys, counts, query, onQuery, onPick }: LifetimeSearchProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = normalizeTitle(query);
    if (!q) return [];
    const hits: number[] = [];
    keys.forEach((k, t) => {
      if (k.includes(q)) hits.push(t);
    });
    return hits.sort((a, b) => counts[b] - counts[a]).slice(0, MAX_SUGGESTIONS);
  }, [query, keys, counts]);

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

  const onChange = (value: string) => {
    setHighlight(0);
    setOpen(value.trim().length > 0);
    onQuery(value);
  };

  // Row 0 is the free-text search; rows 1.. are titles.
  const choose = (row: number) => {
    track('lifetime.search', { suggestion: row > 0 });
    setOpen(false);
    if (row === 0) {
      inputRef.current?.blur();
      return;
    }
    onPick(suggestions[row - 1]);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(highlight);
    }
  };

  const clear = () => {
    setOpen(false);
    onQuery('');
    inputRef.current?.focus();
  };

  const rowClass = (i: number) =>
    `w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors ${
      i === highlight ? 'bg-secondary' : ''
    }`;

  const dropdown =
    open && rect
      ? createPortal(
          <div
            ref={dropdownRef}
            onWheel={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: rect.bottom + 8,
              right: Math.max(8, window.innerWidth - rect.right),
              width: Math.min(320, window.innerWidth - 16),
              backgroundColor: 'var(--card)',
              overscrollBehavior: 'contain',
            }}
            className="max-h-96 overflow-y-auto border border-border rounded-lg shadow-2xl z-[100] py-1"
          >
            <button onClick={() => choose(0)} onMouseEnter={() => setHighlight(0)} className={rowClass(0)}>
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground truncate">
                Everything mentioning “{query.trim()}”
              </span>
            </button>
            {suggestions.map((t, i) => (
              <button
                key={t}
                onClick={() => choose(i + 1)}
                onMouseEnter={() => setHighlight(i + 1)}
                className={rowClass(i + 1)}
              >
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">{titles[t]}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{counts[t]}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-2.5 h-9 w-36 sm:w-44 md:w-52 focus-within:ring-1 focus-within:ring-primary">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search names..."
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
