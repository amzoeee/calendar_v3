'use client';

import { useState } from 'react';

export default function BoardNameDialog({
  heading,
  initialValue = '',
  submitLabel,
  onCancel,
  onSubmit,
}: {
  heading: string;
  initialValue?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialValue);
  const trimmed = name.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-card border border-border rounded-xl p-5 space-y-4 shadow-2xl">
        <h2 className="text-sm font-bold text-foreground">{heading}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onSubmit(trimmed);
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
            }
          }}
          placeholder="List name"
          className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => trimmed && onSubmit(trimmed)}
            disabled={!trimmed}
            className="px-3 py-2 rounded text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
