'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { X } from 'lucide-react';
import { parseWeekStart, WEEK_START_COOKIE } from '@/lib/week';
import CalendarMonth from './CalendarMonth';
import Button from './Button';

/**
 * Replacement for `<input type="date">`. Value is 'YYYY-MM-DD' or ''.
 *
 * Typing works like TimeInput: parts follow the locale's order, a digit that
 * can't start a two-digit number moves on, ← → move between parts, ↑ ↓ step,
 * Backspace clears. Leave the year blank and press Enter (or leave the field)
 * to get the current year.
 *
 * Clicking opens a month calendar under the field (Alt+↓ from the keyboard).
 * On touch screens the keyboard stays down and a calendar sheet opens instead,
 * like the native picker.
 *
 * Controlled with `value`/`onChange`, or uncontrolled with `defaultValue` and
 * `name` for plain form posts.
 */

type Field = 'month' | 'day' | 'year';

interface Parts {
  month: number | null;
  day: number | null;
  year: number | null;
}

interface Props
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type' | 'defaultValue'> {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}

const LENGTH: Record<Field, number> = { month: 2, day: 2, year: 4 };
const PLACEHOLDER: Record<Field, string> = { month: 'mm', day: 'dd', year: 'yyyy' };
const EMPTY: Parts = { month: null, day: null, year: null };

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const daysIn = (year: number | null, month: number | null) =>
  month === null ? 31 : new Date(year ?? 2000, month, 0).getDate();

const DEFAULT_LAYOUT = { order: ['month', 'day', 'year'] as Field[], sep: '/' };
let layoutCache: typeof DEFAULT_LAYOUT | null = null;
/** Part order and separator follow the locale: en-US is MM/DD/YYYY, en-GB DD/MM/YYYY. */
function localeLayout() {
  if (layoutCache) return layoutCache;
  const parts = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(2000, 0, 2));
  const order = parts.map((p) => p.type).filter((t): t is Field => t === 'year' || t === 'month' || t === 'day');
  const sep = parts.find((p) => p.type === 'literal')?.value.trim().charAt(0) || '/';
  layoutCache = order.length === 3 ? { order, sep } : DEFAULT_LAYOUT;
  return layoutCache;
}

const subscribeNever = () => () => {};
const COARSE = '(pointer: coarse)';
const subscribeCoarse = (cb: () => void) => {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

function fromValue(value: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return EMPTY;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Null while incomplete; '' once every part is cleared. */
function toValue(p: Parts): string | null {
  if (p.month === null && p.day === null && p.year === null) return '';
  if (p.month === null || p.day === null || p.year === null) return null;
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function readWeekStart() {
  return parseWeekStart(new RegExp(`(?:^|; )${WEEK_START_COOKIE}=(\\d)`).exec(document.cookie)?.[1]);
}

export default function DateInput({
  value: valueProp,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  className,
  name,
  ...rest
}: Props) {
  const { order, sep } = useSyncExternalStore(subscribeNever, localeLayout, () => DEFAULT_LAYOUT);
  const coarse = useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);

  const [inner, setInner] = useState(defaultValue ?? '');
  const value = valueProp ?? inner;
  const commit = (v: string) => {
    if (valueProp === undefined) setInner(v);
    onChange?.(v);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [parts, setParts] = useState<Parts>(() => fromValue(value));
  const [active, setActive] = useState(0);
  const [buffer, setBuffer] = useState('');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  // Follow the value when it changes to something other than what's on screen.
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    if (toValue(parts) !== value) {
      setParts(fromValue(value));
      setBuffer('');
    }
  }

  const field = order[active];
  const last = order.length - 1;

  const emit = (next: Parts) => {
    // An out-of-range day (Feb 30) snaps to the month's last day.
    if (next.day !== null && next.month !== null && next.day > daysIn(next.year, next.month)) {
      next = { ...next, day: daysIn(next.year, next.month) };
    }
    setParts(next);
    const v = toValue(next);
    if (v !== null && v !== value) commit(v);
  };

  /** Writes a half-typed part if it's valid on its own; drops it otherwise. */
  const flush = (p: Parts = parts): Parts => {
    if (!buffer) return p;
    const n = Number(buffer);
    setBuffer('');
    if (field === 'year') {
      if (buffer.length === 4) return { ...p, year: n };
      if (buffer.length <= 2) return { ...p, year: 2000 + n };
      return p;
    }
    if (n >= 1 && n <= (field === 'month' ? 12 : 31)) return { ...p, [field]: n };
    return p;
  };

  /** Month and day without a year mean this year. */
  const withYear = (p: Parts): Parts =>
    p.month !== null && p.day !== null && p.year === null ? { ...p, year: new Date().getFullYear() } : p;

  const move = (to: number) => {
    emit(flush());
    setActive(Math.max(0, Math.min(last, to)));
  };

  const typeDigit = (d: number) => {
    if (field === 'year') {
      const next = buffer + d;
      if (next.length < 4) return setBuffer(next);
      setBuffer('');
      emit({ ...parts, year: Number(next) });
      if (active < last) setActive(active + 1);
      return;
    }
    const max = field === 'month' ? 12 : 31;
    const next = Number(buffer + d);
    if (buffer && next >= 1 && next <= max) {
      setBuffer('');
      emit({ ...parts, [field]: next });
      if (active < last) setActive(active + 1);
      return;
    }
    // A fresh first digit: nothing typed yet, or the two don't make a valid number.
    if (d * 10 > max) {
      setBuffer('');
      if (d >= 1) emit({ ...parts, [field]: d });
      if (active < last) setActive(active + 1);
    } else {
      setBuffer(String(d));
    }
  };

  const step = (dir: 1 | -1) => {
    const p = flush();
    const today = new Date();
    if (field === 'month') {
      emit({ ...p, month: p.month === null ? today.getMonth() + 1 : ((p.month - 1 + dir + 12) % 12) + 1 });
    } else if (field === 'day') {
      const dim = daysIn(p.year, p.month);
      emit({ ...p, day: p.day === null ? today.getDate() : ((p.day - 1 + dir + dim) % dim) + 1 });
    } else {
      emit({ ...p, year: (p.year ?? today.getFullYear()) + (p.year === null ? 0 : dir) });
    }
  };

  const clear = () => {
    if (buffer) return setBuffer('');
    if (parts[field] === null) {
      if (active > 0) setActive(active - 1);
      return;
    }
    emit({ ...parts, [field]: null });
  };

  const paste = (text: string) => {
    const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text);
    const nums = iso ? [iso[2], iso[3], iso[1]] : text.match(/\d+/g);
    if (!nums || nums.length < 2) return;
    const byField = iso
      ? { month: Number(nums[0]), day: Number(nums[1]), year: Number(nums[2]) }
      : Object.fromEntries(order.map((f, i) => [f, nums[i] === undefined ? null : Number(nums[i])]));
    const p = { ...EMPTY, ...byField } as Parts;
    if (p.year !== null && p.year < 100) p.year += 2000;
    if (!p.month || p.month > 12 || !p.day || p.day > 31) return;
    setBuffer('');
    emit(withYear(p));
  };

  // Every edit goes through here; the DOM value is never edited directly.
  const handlers = useRef({ typeDigit, move, clear, paste, active });
  useLayoutEffect(() => {
    handlers.current = { typeDigit, move, clear, paste, active };
  });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      e.preventDefault();
      const h = handlers.current;
      if (e.inputType.startsWith('delete')) return h.clear();
      const data = e.data ?? e.dataTransfer?.getData('text') ?? '';
      if (e.inputType === 'insertFromPaste' || data.length > 1) return h.paste(data);
      if (/\d/.test(data)) h.typeDigit(Number(data));
      else if (/[/.\-\s]/.test(data)) h.move(h.active + 1);
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  // ---- Display ---------------------------------------------------------

  const segText = (f: Field) => {
    if (f === field && buffer) return buffer.padStart(LENGTH[f], '0');
    const n = parts[f];
    return n === null ? PLACEHOLDER[f] : pad(n, LENGTH[f]);
  };
  const empty = parts.month === null && parts.day === null && parts.year === null && !buffer;
  const display = empty ? '' : order.map(segText).join(sep);
  const starts = order.map((_, i) => order.slice(0, i).reduce((sum, f) => sum + LENGTH[f] + 1, 0));
  const segAt = (pos: number) => {
    const i = starts.findIndex((s, j) => pos <= s + LENGTH[order[j]]);
    return i === -1 ? last : i;
  };

  // Keep the active part highlighted, as a native date input does.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !focused || coarse || document.activeElement !== el || !display) return;
    el.setSelectionRange(starts[active], starts[active] + LENGTH[order[active]]);
  });

  // ---- Picker ----------------------------------------------------------

  const openPicker = () => {
    if (rest.disabled) return;
    setAnchor(inputRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  const pick = (dateStr: string) => {
    setBuffer('');
    emit(fromValue(dateStr));
    setOpen(false);
    if (coarse) inputRef.current?.blur();
    else inputRef.current?.focus();
  };

  // Close the desktop popover on outside clicks. Its own mousedowns are
  // stopped below, so this only ever sees clicks elsewhere.
  useEffect(() => {
    if (!open || coarse) return;
    const onDown = (e: MouseEvent) => {
      if (e.target !== inputRef.current) setOpen(false);
    };
    const onScroll = () => setAnchor(inputRef.current?.getBoundingClientRect() ?? null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, coarse]);

  // Clicks inside the picker shouldn't count as outside clicks for whatever
  // popup this field lives in, nor (on desktop) take focus from the field.
  const pickerRefCallback = (el: HTMLDivElement | null) => {
    popoverRef.current = el;
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (!coarse && !(e.target as Element).closest('[data-month]')) e.preventDefault();
    });
  };

  const required = rest.required;
  const weekStart = open ? readWeekStart() : undefined;
  const selected = toValue(parts) || null;

  const popover =
    open && !coarse && anchor
      ? createPortal(
          <div
            ref={pickerRefCallback}
            style={{
              position: 'fixed',
              left: Math.max(8, Math.min(anchor.left, window.innerWidth - 248)),
              ...(window.innerHeight - anchor.bottom < 300
                ? { bottom: window.innerHeight - anchor.top + 4 }
                : { top: anchor.bottom + 4 }),
            }}
            className="w-60 z-[100] bg-card border border-border rounded-lg shadow-2xl p-3"
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== inputRef.current) setOpen(false);
            }}
          >
            <CalendarMonth selected={selected} onSelect={pick} weekStart={weekStart} />
          </div>,
          document.body
        )
      : null;

  const sheet =
    open && coarse
      ? createPortal(
          <div ref={pickerRefCallback} className="fixed inset-0 z-[100] flex items-end md:items-center md:justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={rest['aria-label'] ?? 'Pick a date'}
              className="relative w-full md:w-96 bg-card border-t md:border border-border rounded-t-2xl md:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4"
            >
              <div className="w-9 h-1 rounded-full bg-muted mx-auto md:hidden" />
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight">{rest['aria-label'] ?? 'Pick a date'}</h2>
                <Button
                  variant="ghost"
                  size="none"
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div>
                <CalendarMonth selected={selected} onSelect={pick} weekStart={weekStart} size="lg" />
              </div>
              <div className="flex gap-2">
                <Button
                  size="none"
                  type="button"
                  onClick={() => pick(new Date().toLocaleDateString('en-CA'))}
                  className="flex-1 px-4 py-2.5 rounded text-sm font-semibold"
                >
                  Today
                </Button>
                {!required && (
                  <Button
                    size="none"
                    type="button"
                    onClick={() => {
                      setBuffer('');
                      emit(EMPTY);
                      setOpen(false);
                    }}
                    className="flex-1 px-4 py-2.5 rounded text-sm font-semibold"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        // Touch screens get the calendar sheet rather than a keyboard.
        inputMode={coarse ? 'none' : 'numeric'}
        autoComplete="off"
        spellCheck={false}
        placeholder={order.map((f) => PLACEHOLDER[f]).join(sep)}
        value={display}
        onChange={() => {}}
        className={`tabular-nums ${className ?? ''}`}
        onFocus={(e) => {
          setFocused(true);
          if (!open) setActive(0);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (popoverRef.current?.contains(e.relatedTarget)) return;
          if (!coarse) setOpen(false);
          const p = withYear(flush());
          if (toValue(p) === null) setParts(fromValue(value));
          else emit(p);
          onBlur?.(e);
        }}
        onClick={() => {
          if (coarse || !open) openPicker();
        }}
        onMouseUp={(e) => {
          if (coarse) return;
          const seg = segAt(e.currentTarget.selectionStart ?? 0);
          if (seg !== active) move(seg);
          else if (display) e.currentTarget.setSelectionRange(starts[seg], starts[seg] + LENGTH[order[seg]]);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            openPicker();
          } else if (e.key === 'Escape' && open) {
            setOpen(false);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            move(active + (e.key === 'ArrowRight' ? 1 : -1));
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(e.key === 'ArrowUp' ? 1 : -1);
          } else if (e.key === 'Enter') {
            // Flushed so a consumer's own Enter handler reads the filled-in date.
            const p = withYear(flush());
            flushSync(() => emit(p));
            setOpen(false);
          }
          onKeyDown?.(e);
        }}
      />
      {popover}
      {sheet}
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}
