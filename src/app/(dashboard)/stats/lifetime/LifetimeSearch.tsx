'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '@/lib/track';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { normalizeTitle } from '@/lib/titleParts';
import Button from '@/app/components/Button';

const MAX_SUGGESTIONS = 30;
const MAX_PART_SUGGESTIONS = 5;
const MAX_TAG_SUGGESTIONS = 5;

interface LifetimeSearchProps {
  titles: string[];
  keys: string[];
  counts: number[];
  parts: { part: string; count: number }[];
  tags: { tag: number; count: number }[];
  tagNames: string[];
  colorOf: (tag: number) => string;
  query: string;
  // Fires on every keystroke, so the chart highlights as you type.
  onQuery: (q: string) => void;
  // The parent sets the box to the picked title.
  onPick: (title: number) => void;
  onPickPart: (part: string) => void;
  onPickTag: (tag: number) => void;
}

/**
 * Same look as EventSearch, but it filters the already-loaded titles instead
 * of querying the server: the first row keeps the typed text as a search,
 * then tags, segments (parts of titles), and whole titles.
 */
export default function LifetimeSearch({
  titles,
  keys,
  counts,
  parts,
  tags,
  tagNames,
  colorOf,
  query,
  onQuery,
  onPick,
  onPickPart,
  onPickTag,
}: LifetimeSearchProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tagSuggestions = useMemo(() => {
    const q = normalizeTitle(query);
    if (!q) return [];
    return tags
      .filter((t) => normalizeTitle(tagNames[t.tag]).includes(q))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TAG_SUGGESTIONS);
  }, [query, tags, tagNames]);

  const partSuggestions = useMemo(() => {
    const q = normalizeTitle(query);
    if (!q) return [];
    return parts
      .filter((p) => p.part.includes(q))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_PART_SUGGESTIONS);
  }, [query, parts]);

  // A title that is just a listed segment would pick the same thing.
  const suggestions = useMemo(() => {
    const q = normalizeTitle(query);
    if (!q) return [];
    const shown = new Set(partSuggestions.map((p) => p.part));
    const hits: number[] = [];
    keys.forEach((k, t) => {
      if (counts[t] > 0 && k.includes(q) && !shown.has(k)) hits.push(t);
    });
    return hits.sort((a, b) => counts[b] - counts[a]).slice(0, MAX_SUGGESTIONS);
  }, [query, keys, counts, partSuggestions]);
  const tagRows = tagSuggestions.length;
  const rowCount = 1 + tagRows + partSuggestions.length + suggestions.length;

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

  // Row 0 is the free-text search, then tags, segments, and titles.
  const choose = (row: number) => {
    const isTag = row > 0 && row <= tagRows;
    const isPart = row > tagRows && row <= tagRows + partSuggestions.length;
    track('lifetime.search', { suggestion: row > 0, segment: isPart, tag: isTag });
    setOpen(false);
    if (isTag) onPickTag(tagSuggestions[row - 1].tag);
    else if (isPart) onPickPart(partSuggestions[row - 1 - tagRows].part);
    else if (row > 0) onPick(suggestions[row - 1 - tagRows - partSuggestions.length]);
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
      setHighlight((h) => Math.min(h + 1, rowCount - 1));
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
            <Button variant="unstyled" onClick={() => choose(0)} onMouseEnter={() => setHighlight(0)} className={rowClass(0)}>
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground truncate">
                Everything mentioning “{query.trim()}”
              </span>
            </Button>
            {tagSuggestions.map(({ tag, count }, i) => (
              <Button
                variant="unstyled"
                key={`tag:${tag}`}
                onClick={() => choose(i + 1)}
                onMouseEnter={() => setHighlight(i + 1)}
                className={rowClass(i + 1)}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(tag) }} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">{tagNames[tag]}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                  tag
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{count}</span>
              </Button>
            ))}
            {partSuggestions.map(({ part, count }, i) => (
              <Button
                variant="unstyled"
                key={`part:${part}`}
                onClick={() => choose(i + 1 + tagRows)}
                onMouseEnter={() => setHighlight(i + 1 + tagRows)}
                className={rowClass(i + 1 + tagRows)}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full border border-border bg-secondary text-foreground">
                    {part}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{count}</span>
              </Button>
            ))}
            {suggestions.map((t, i) => {
              const row = i + 1 + tagRows + partSuggestions.length;
              return (
                <Button
                  variant="unstyled"
                  key={t}
                  onClick={() => choose(row)}
                  onMouseEnter={() => setHighlight(row)}
                  className={rowClass(row)}
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">{titles[t]}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{counts[t]}</span>
                </Button>
              );
            })}
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
          placeholder="Name or tag..."
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none w-full"
        />
        {query && (
          <Button
            variant="ghost"
            size="none"
            onClick={clear}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {dropdown}
    </div>
  );
}
