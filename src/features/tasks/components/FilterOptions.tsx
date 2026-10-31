'use client';

import { type Dispatch, type SetStateAction } from 'react';
import { Bell, Check, Star } from 'lucide-react';
import { type TaskTag } from '../types';

/**
 * A column's filter choices. Shown in its own dropdown or as a section of the
 * overflow menu, depending on how much room the column has.
 */
export default function FilterOptions({
  starredList,
  starredOnly,
  setStarredOnly,
  remindersOnly,
  setRemindersOnly,
  tags,
  filterTagIds,
  setFilterTagIds,
  activeFilters,
}: {
  starredList: boolean;
  starredOnly: boolean;
  setStarredOnly: Dispatch<SetStateAction<boolean>>;
  remindersOnly: boolean;
  setRemindersOnly: (on: boolean) => void;
  /** Only the tags in use on this list. */
  tags: TaskTag[];
  filterTagIds: number[];
  setFilterTagIds: Dispatch<SetStateAction<number[]>>;
  activeFilters: number;
}) {
  const checkbox = (on: boolean) => (
    <span
      className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
        on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
      }`}
    >
      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );

  return (
    <>
      {!starredList && (
        <button
          onClick={() => setStarredOnly((v) => !v)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
        >
          {checkbox(starredOnly)}
          <Star className="h-3.5 w-3.5 text-amber-400" fill="currentColor" />
          Starred
        </button>
      )}

      {/* The rail's toggle, for mobile where there is no rail. */}
      <button
        onClick={() => setRemindersOnly(!remindersOnly)}
        className="md:hidden w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
      >
        {checkbox(remindersOnly)}
        <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        Active reminders only
      </button>

      {tags.map((t) => {
        const on = filterTagIds.includes(t.id);
        return (
          <button
            key={t.id}
            onClick={() =>
              setFilterTagIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))
            }
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-secondary transition-colors cursor-pointer"
          >
            {checkbox(on)}
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            <span className="truncate">{t.name}</span>
          </button>
        );
      })}

      {activeFilters > 0 && (
        <button
          onClick={() => {
            setFilterTagIds([]);
            setStarredOnly(false);
          }}
          className="w-full text-left px-2 py-1.5 text-sm rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
        >
          Clear filters
        </button>
      )}
    </>
  );
}
