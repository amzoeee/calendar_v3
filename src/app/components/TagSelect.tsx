'use client';

import React from 'react';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
}

interface TagSelectProps {
  tags: Tag[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Optional: pass a name attr for native form submissions */
  name?: string;
}

export default function TagSelect({ tags, value, onChange, className, name }: TagSelectProps) {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'block w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent cursor-pointer'
      }
    >
      <option value="">None</option>
      {tags
        .filter((t) => !t.isArchived)
        .map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
    </select>
  );
}
