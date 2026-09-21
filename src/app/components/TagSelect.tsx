'use client';

import React from 'react';
import { scopeAllows } from '@/lib/tags';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  scope: string;
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
      {/* Events only: a tag scoped to tasks is deliberately absent here. */}
      {tags
        .filter((t) => !t.isArchived && scopeAllows(t.scope, 'event'))
        .map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
    </select>
  );
}
