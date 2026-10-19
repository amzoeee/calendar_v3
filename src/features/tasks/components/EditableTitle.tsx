'use client';

import { useState } from 'react';

/**
 * Inline rename field. Holds its own draft so that typing in one row can't
 * re-render every other row in the column.
 */
export default function EditableTitle({
  initial,
  onCommit,
  onCancel,
  onMove,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** Absent on a list with no manual order to rearrange. */
  onMove?: (action: 'up' | 'down' | 'indent' | 'outdent') => void;
}) {
  const [value, setValue] = useState(initial);

  // Renaming is where a row already has focus, so it's where the keyboard
  // equivalents of the drag gestures live. Each one saves the name first, so
  // the move can't strand a half-typed edit.
  const move = (action: 'up' | 'down' | 'indent' | 'outdent') => {
    if (!onMove) return;
    onCommit(value);
    onMove(action);
  };

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
        // Left alone when there's nothing to move: swallowing Tab would take
        // away the only way to leave the field.
        if (e.key === 'Tab' && onMove) {
          e.preventDefault();
          move(e.shiftKey ? 'outdent' : 'indent');
        }
        if (onMove && (e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          move(e.key === 'ArrowUp' ? 'up' : 'down');
        }
      }}
      className="w-full bg-transparent border-b border-border text-sm text-foreground focus:outline-none focus:border-foreground py-0.5"
    />
  );
}
