'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const UNDO_MS = 7000;

// The toast carries the action that reverses whatever just happened, so each
// raiser decides what "undo" means for it. `undo: null` renders the message
// without a button — better than offering one that does nothing.
export interface UndoOptions {
  message: string;
  undo: (() => void | Promise<unknown>) | null;
}

interface UndoApi {
  raiseUndo: (options: UndoOptions) => void;
  dismissUndo: () => void;
}

const UndoContext = createContext<UndoApi | null>(null);

/**
 * "Did X · Undo" toast shared across the dashboard:
 *
 *   const { raiseUndo } = useUndo();
 *   raiseUndo({ message: 'Deleted “Lunch”', undo: () => restore(snapshot) });
 */
export function useUndo(): UndoApi {
  const api = useContext(UndoContext);
  if (!api) throw new Error('useUndo must be used inside <UndoProvider>');
  return api;
}

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<UndoOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissUndo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const raiseUndo = useCallback((options: UndoOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(options);
    timer.current = setTimeout(() => setToast(null), UNDO_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const runUndo = async () => {
    const current = toast;
    if (!current?.undo) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      await current.undo();
      // The undo may have raised a toast of its own, e.g. to say why it failed.
      setToast((t) => (t === current ? null : t));
    } catch {
      raiseUndo({ message: 'Couldn’t undo that', undo: null });
    } finally {
      setBusy(false);
    }
  };

  const api = useMemo(() => ({ raiseUndo, dismissUndo }), [raiseUndo, dismissUndo]);

  return (
    <UndoContext.Provider value={api}>
      {children}
      {toast && (
        <div
          role="status"
          // Mobile clears the tab bar; desktop has none.
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-[70] flex items-center gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-2xl max-w-[calc(100vw-2rem)]"
        >
          <span className="text-sm text-foreground truncate">{toast.message}</span>
          {toast.undo && (
            <button
              onClick={runUndo}
              disabled={busy}
              className="text-sm font-semibold text-foreground underline underline-offset-2 hover:opacity-80 shrink-0 cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Undoing…' : 'Undo'}
            </button>
          )}
          <button
            onClick={dismissUndo}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </UndoContext.Provider>
  );
}
