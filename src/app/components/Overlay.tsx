'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A modal layer: backdrop plus panel, portalled to document.body so no
 * `overflow-hidden` or transformed parent can clip it.
 *
 * Escape and a backdrop click call `onClose`; with overlays stacked, only the
 * top one responds, and a child can keep Escape for itself with
 * preventDefault. Focus moves into the panel on open (to `initialFocus`, an
 * `autoFocus` child, or the panel itself), Tab stays inside, and focus goes
 * back to the opener on close. `manageFocus={false}` leaves focus alone, for
 * pickers whose field should keep it.
 *
 * `variant` sets the shape:
 * - dialog: a centred card;
 * - sheet: a bottom sheet with a drag handle;
 * - responsive: a sheet below `md`, a centred card from `md` up;
 * - none: nothing, for panels placed with `layerClassName` and `className`.
 *
 * `className` adds to the variant's classes rather than overriding them, as
 * with Button. The panel has `aria-modal`, which isInsideModal checks so
 * page-level shortcuts stand aside.
 */

const LAYERS = {
  dialog: 'items-center justify-center p-4',
  sheet: 'items-end',
  responsive: 'items-end md:items-center md:justify-center',
  none: '',
};

const PANELS = {
  dialog: 'relative w-full bg-card border border-border rounded-xl shadow-2xl',
  sheet: 'relative w-full bg-card border-t border-border rounded-t-2xl',
  responsive: 'relative w-full bg-card border-t md:border border-border rounded-t-2xl md:rounded-2xl',
  none: '',
};

const HANDLES: Partial<Record<OverlayVariant, string>> = {
  sheet: 'w-9 h-1 rounded-full bg-muted mx-auto',
  responsive: 'w-9 h-1 rounded-full bg-muted mx-auto md:hidden',
};

export type OverlayVariant = keyof typeof LAYERS;

interface Props extends Omit<React.ComponentPropsWithoutRef<'div'>, 'role'> {
  onClose: () => void;
  variant?: OverlayVariant;
  role?: 'dialog' | 'alertdialog';
  /** Extra classes for the full-screen layer that positions the panel. */
  layerClassName?: string;
  backdropClassName?: string;
  zIndex?: number;
  /** Element to focus on open; defaults to an autoFocus child, else the panel. */
  initialFocus?: (panel: HTMLDivElement) => HTMLElement | null | undefined;
  manageFocus?: boolean;
  panelRef?: React.Ref<HTMLDivElement>;
  layerRef?: React.Ref<HTMLDivElement>;
}

// Open overlays, newest last; only the last one handles keys.
const stack: object[] = [];

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';

function tabbables(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0
  );
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function handleKey(e: KeyboardEvent, token: object, panel: HTMLElement, onClose: () => void, manageFocus: boolean) {
  if (stack[stack.length - 1] !== token || e.defaultPrevented) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
    return;
  }
  if (e.key !== 'Tab' || !manageFocus) return;
  const active = document.activeElement;
  // Focus in another portal (a Select menu, a date popover) moves on its own.
  if (active && active !== document.body && !panel.contains(active)) return;
  const items = tabbables(panel);
  const first = items[0] ?? panel;
  const last = items[items.length - 1] ?? panel;
  const outside = !panel.contains(active) || active === panel;
  if (e.shiftKey ? outside || active === first : outside || active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

export default function Overlay({
  onClose,
  variant = 'dialog',
  role = 'dialog',
  layerClassName = '',
  backdropClassName = 'bg-black/60',
  zIndex = 100,
  initialFocus,
  manageFocus = true,
  panelRef,
  layerRef,
  className = '',
  onKeyDown,
  children,
  ...props
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [token] = useState(() => ({}));
  // Read before an autoFocus child takes focus.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  );
  const onCloseRef = useRef(onClose);
  const options = useRef({ initialFocus, manageFocus });
  useEffect(() => {
    onCloseRef.current = onClose;
    options.current = { initialFocus, manageFocus };
  });

  useEffect(() => {
    stack.push(token);
    const el = panel.current!;
    const { initialFocus, manageFocus } = options.current;

    const focusIn = () => {
      const target = initialFocus?.(el);
      if (target) target.focus();
      else if (!el.contains(document.activeElement)) el.focus();
    };
    // Retried next frame for panels hidden until they're measured.
    let frame = 0;
    if (manageFocus) {
      focusIn();
      frame = requestAnimationFrame(() => {
        if (!el.contains(document.activeElement)) focusIn();
      });
    }

    // Keys from inside reach the panel's onKeyDown; this catches the ones
    // left on the body when the focused element went away.
    const onBodyKey = (e: KeyboardEvent) => {
      if (e.target !== document.body && e.target !== document.documentElement) return;
      handleKey(e, token, el, onCloseRef.current, options.current.manageFocus);
    };
    document.addEventListener('keydown', onBodyKey);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onBodyKey);
      stack.splice(stack.indexOf(token), 1);
      if (!options.current.manageFocus || !opener?.isConnected) return;
      const active = document.activeElement;
      if (!active || active === document.body || el.contains(active)) opener.focus();
    };
  }, [token, opener]);

  if (typeof document === 'undefined') return null;

  const handle = HANDLES[variant];

  return createPortal(
    <div
      ref={(node) => setRef(layerRef, node)}
      style={{ zIndex }}
      className={`fixed inset-0 flex ${LAYERS[variant]} ${layerClassName}`}
    >
      <div className={`absolute inset-0 ${backdropClassName}`} onClick={() => onClose()} aria-hidden="true" />
      <div
        {...props}
        ref={(node) => {
          panel.current = node;
          setRef(panelRef, node);
        }}
        role={role}
        aria-modal="true"
        // After the consumer's handler, so it can claim a key with preventDefault.
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (panel.current) handleKey(e.nativeEvent, token, panel.current, onClose, manageFocus);
        }}
        // Focusable so a click on the panel's text keeps keys inside it.
        tabIndex={-1}
        className={`focus:outline-none ${PANELS[variant]} ${className}`}
      >
        {handle && <div className={handle} />}
        {children}
      </div>
    </div>,
    document.body
  );
}
