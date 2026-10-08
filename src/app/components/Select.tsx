'use client';

import React, { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Classes for the trigger; the menu takes its font size from it. */
  className?: string;
  id?: string;
  /** Submits the value with a surrounding form. */
  name?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * Whether a key event belongs to a Select, for page shortcuts that listen on
 * window: 'open' means the menu owns the key, 'closed' that the trigger is
 * focused like a form field.
 */
export function selectStateOf(target: EventTarget | null): 'open' | 'closed' | null {
  const trigger = target instanceof Element ? target.closest('[data-select]') : null;
  if (!trigger) return null;
  return trigger.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed';
}

const TYPEAHEAD_RESET_MS = 700;
const MENU_MAX_HEIGHT = 288;
const GAP = 4;

interface Placement {
  left: number;
  minWidth: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  fontSize: string;
}

export default function Select<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
  id,
  name,
  disabled,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ query: '', at: 0 });
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;

  /** The nearest enabled option from `from`, stepping by `dir`. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return -1;
  };

  const openMenu = () => {
    setActive(enabled(selectedIndex) ? selectedIndex : step(0, 1));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setPlacement(null);
  };

  const commit = (i: number) => {
    if (enabled(i) && options[i].value !== value) onChange(options[i].value);
  };

  /**
   * Type-to-select, as a native select does: letters build up a prefix, and
   * pressing the same letter repeatedly cycles through the options it starts.
   */
  const match = (char: string, from: number) => {
    const now = Date.now();
    const t = typeahead.current;
    t.query = now - t.at > TYPEAHEAD_RESET_MS ? char : t.query + char;
    t.at = now;

    const q = t.query.toLowerCase();
    const cycling = q.length > 1 && [...q].every((c) => c === q[0]);
    const prefix = cycling ? q[0] : q;
    const start = cycling || q.length === 1 ? from + 1 : from;
    for (let k = 0; k < options.length; k++) {
      const i = (Math.max(start, 0) + k) % options.length;
      if (enabled(i) && options[i].label.toLowerCase().startsWith(prefix)) return i;
    }
    return -1;
  };

  // Handled natively rather than through React: the app root is the document,
  // so only a listener below it can keep a key from page-level shortcuts that
  // also listen there (Escape closing the task editor, `n` for a new task).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) return;
    const typing = Date.now() - typeahead.current.at <= TYPEAHEAD_RESET_MS;
    const printable = e.key.length === 1 && !(e.key === ' ' && !typing);
    let handled = true;

    if (!open) {
      if (printable) {
        commit(match(e.key, selectedIndex));
      } else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        openMenu();
      } else {
        handled = false;
      }
    } else {
      switch (e.key) {
        case 'ArrowDown':
          setActive((a) => step(a + 1, 1) === -1 ? a : step(a + 1, 1));
          break;
        case 'ArrowUp':
          setActive((a) => step(a - 1, -1) === -1 ? a : step(a - 1, -1));
          break;
        case 'Home':
          setActive(step(0, 1));
          break;
        case 'End':
          setActive(step(options.length - 1, -1));
          break;
        case 'PageDown':
          setActive((a) => step(Math.min(a + 8, options.length - 1), -1));
          break;
        case 'PageUp':
          setActive((a) => step(Math.max(a - 8, 0), 1));
          break;
        case 'Enter':
        case ' ':
          commit(active);
          close();
          break;
        case 'Tab':
          // Take the highlighted option and let focus move on as usual.
          commit(active);
          close();
          handled = false;
          break;
        case 'Escape':
          close();
          break;
        default:
          if (printable) {
            const i = match(e.key, active);
            if (i !== -1) setActive(i);
          } else {
            handled = false;
          }
      }
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const listener = (e: KeyboardEvent) => onKey(e);
    el.addEventListener('keydown', listener);
    return () => el.removeEventListener('keydown', listener);
  }, []);

  // Place the menu under the trigger, or above it when there's more room there.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP * 2;
      const above = r.top - GAP * 2;
      const needed = Math.min(MENU_MAX_HEIGHT, (menuRef.current?.scrollHeight ?? MENU_MAX_HEIGHT) + 2);
      const flip = below < needed && above > below;
      setPlacement({
        left: Math.max(GAP, Math.min(r.left, window.innerWidth - r.width - GAP)),
        minWidth: r.width,
        maxHeight: Math.min(MENU_MAX_HEIGHT, flip ? above : below),
        ...(flip ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
        fontSize: getComputedStyle(trigger).fontSize,
      });
    };
    // The menu's own scrolling must not re-place it: a new placement re-runs
    // the scroll-into-view below, snapping a touch scroll back to the selection.
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Close on a press anywhere else. Presses inside the menu stop at the menu
  // (below), so a popover's own click-outside handler doesn't treat picking an
  // option as leaving it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const attachMenu = useCallback((menu: HTMLDivElement | null) => {
    menuRef.current = menu;
    if (!menu) return;
    const stop = (e: Event) => {
      e.stopPropagation();
      // Keep focus on the trigger so the keyboard keeps working.
      if (e.type === 'mousedown') e.preventDefault();
    };
    menu.addEventListener('mousedown', stop);
    menu.addEventListener('touchstart', stop, { passive: true });
    return () => {
      menu.removeEventListener('mousedown', stop);
      menu.removeEventListener('touchstart', stop);
    };
  }, []);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, placement, listId]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        data-select=""
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onBlur={close}
        className={`flex items-center justify-between gap-1.5 text-left ${className}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {name && <input type="hidden" name={name} value={String(value)} />}

      {open &&
        createPortal(
          <div
            ref={attachMenu}
            id={listId}
            role="listbox"
            style={
              placement
                ? {
                    left: placement.left,
                    top: placement.top,
                    bottom: placement.bottom,
                    minWidth: placement.minWidth,
                    maxHeight: placement.maxHeight,
                    fontSize: placement.fontSize,
                  }
                : { visibility: 'hidden' }
            }
            className="fixed z-[200] max-w-[calc(100vw-8px)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl"
          >
            {options.map((o, i) => {
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={String(o.value)}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onMouseMove={() => enabled(i) && i !== active && setActive(i)}
                  onClick={() => {
                    if (!enabled(i)) return;
                    commit(i);
                    close();
                  }}
                  className={`flex items-center gap-2 rounded px-2.5 py-2 md:py-1.5 whitespace-nowrap select-none ${
                    o.disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : `cursor-pointer ${i === active ? 'bg-secondary text-foreground' : ''}`
                  }`}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${isSelected ? '' : 'invisible'}`} />
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
