'use client';

import { useState } from 'react';
import Overlay from '@/app/components/Overlay';
import Button from '@/app/components/Button';

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
    <Overlay onClose={onCancel} zIndex={60} aria-label={heading} className="max-w-sm p-5 space-y-4">
      <h2 className="text-sm font-bold text-foreground">{heading}</h2>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed) onSubmit(trimmed);
        }}
        placeholder="List name"
        className="w-full rounded bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="none"
          onClick={onCancel}
          className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
        <Button
          size="none"
          onClick={() => trimmed && onSubmit(trimmed)}
          disabled={!trimmed}
          className="px-3 py-2 rounded text-sm font-semibold"
        >
          {submitLabel}
        </Button>
      </div>
    </Overlay>
  );
}
