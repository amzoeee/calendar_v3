'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Button, { type ButtonVariant } from './Button';

type Tone = 'default' | 'primary' | 'danger';

export interface Choice<T> {
  label: string;
  value: T;
  tone?: Tone;
}

export interface ChooseOptions<T> {
  title: string;
  message?: React.ReactNode;
  choices: Choice<T>[];
  /** Label for the dismiss button; resolves to null. */
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  choose: <T>(options: ChooseOptions<T>) => Promise<T | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

/**
 * In-app replacement for window.confirm. Resolves once the user picks:
 *
 *   const { confirm } = useConfirm();
 *   if (await confirm({ title: 'Delete this event?', destructive: true })) …
 */
export function useConfirm(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return api;
}

/** Whether a key or pointer event came from inside an open modal, so page-level shortcuts can stand aside. */
export function isInsideModal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[aria-modal="true"]') !== null;
}

interface Pending {
  options: ChooseOptions<unknown>;
  resolve: (value: unknown) => void;
}

const TONE_VARIANTS: Record<Tone, ButtonVariant> = {
  default: 'ghost',
  primary: 'secondary',
  danger: 'destructive',
};

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const choose = useCallback(
    <T,>(options: ChooseOptions<T>) =>
      new Promise<T | null>((resolve) => {
        setPending((prev) => {
          // A second request supersedes an unanswered one.
          prev?.resolve(null);
          return { options: options as ChooseOptions<unknown>, resolve: resolve as (v: unknown) => void };
        });
      }),
    []
  );

  const confirm = useCallback(
    async ({ title, message, confirmLabel = 'OK', cancelLabel, destructive }: ConfirmOptions) =>
      (await choose({
        title,
        message,
        cancelLabel,
        choices: [{ label: confirmLabel, value: true, tone: destructive ? 'danger' : 'primary' }],
      })) === true,
    [choose]
  );

  const api = useMemo<DialogApi>(() => ({ confirm, choose }), [confirm, choose]);

  const settle = (value: unknown) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && <Dialog options={pending.options} onSettle={settle} />}
    </DialogContext.Provider>
  );
}

function Dialog({
  options,
  onSettle,
}: {
  options: ChooseOptions<unknown>;
  onSettle: (value: unknown) => void;
}) {
  const { title, message, choices, cancelLabel = 'Cancel' } = options;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const messageId = React.useId();

  // Focus the last (primary) choice so Enter confirms, as window.confirm does,
  // and hand focus back to whatever opened the dialog.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = panelRef.current?.querySelectorAll('button');
    buttons?.[buttons.length - 1]?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(panelRef.current?.querySelectorAll('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'Escape') {
      e.preventDefault();
      onSettle(null);
    } else if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Keep focus inside, cycling through the buttons.
      e.preventDefault();
      const step = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    }
    // Page-level shortcuts shouldn't see keys meant for the dialog.
    e.stopPropagation();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => onSettle(null)} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        onKeyDown={handleKeyDown}
        // Focusable so a click on the panel's text keeps keys inside the dialog.
        tabIndex={-1}
        className="relative w-full focus:outline-none max-w-sm bg-card border border-border rounded-xl p-5 space-y-3 shadow-2xl"
      >
        <h2 id={titleId} className="text-sm font-bold text-foreground">
          {title}
        </h2>
        {message && (
          <div id={messageId} className="text-sm text-muted-foreground whitespace-pre-line">
            {message}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            size="none"
            onClick={() => onSettle(null)}
            className="px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {cancelLabel}
          </Button>
          {choices.map((c) => (
            <Button
              key={c.label}
              variant={TONE_VARIANTS[c.tone ?? 'default']}
              size="none"
              onClick={() => onSettle(c.value)}
              className={`px-3 py-2 rounded text-sm ${
                c.tone && c.tone !== 'default' ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
