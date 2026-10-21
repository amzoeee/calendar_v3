'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { type TaskTag } from '../types';

/**
 * Tag picker for the edit dialog. A searchable list rather than a chip row:
 * event tags and task tags share one set, so this can easily be twenty
 * entries, and twenty chips is a wall.
 */
export default function TagPicker({
  all,
  selected,
  onChange,
}: {
  all: TaskTag[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = all.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  if (all.length === 0) {
    return <p className="text-xs text-muted-foreground">No tags yet — add some in Settings.</p>;
  }

  return (
    <div className="space-y-2">
      {all.length > 6 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tag"
          className="w-full rounded bg-secondary border border-border px-2 py-1.5 md:py-1 text-xs md:text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      <div className="max-h-44 md:max-h-28 overflow-y-auto rounded border border-border">
        {matches.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">No tag matches “{query}”.</p>
        )}
        {matches.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button
              key={t.id}
              onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              className="w-full flex items-center gap-2 px-2 py-1.5 md:py-1 text-sm md:text-xs hover:bg-secondary transition-colors cursor-pointer"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                  on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
                }`}
              >
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="truncate">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
