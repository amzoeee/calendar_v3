'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Replacement for `<input type="time">` (#5). Value is 'HH:MM' (24h) or ''.
 *
 * A plain text input underneath, so forms, `required` and the pages'
 * "is focus in an input" checks treat it like any other field. Edits arrive
 * through `beforeinput` rather than keydown so mobile keyboards, which report
 * most keys as "Unidentified", work too.
 *
 * - 12h or 24h, following the locale unless `hour12` is given.
 * - "4" and "04" both mean 4. A digit that can't start a two-digit number
 *   moves on to the next part straight away.
 * - In 12h, hours 0–23 are accepted too: "16" becomes 4 PM, "00" 12 AM.
 *   Otherwise an hour with no AM/PM yet gets a guess (7–11 AM, 12–6 PM), so
 *   mobile numeric keypads, which have no letters, never need one.
 * - ← → (and `:` or space) move between parts; ↑ ↓ step the current one.
 * - Backspace clears the current part, then moves back.
 * - In 12h, `a` / `p` set AM / PM; tapping AM/PM again toggles it.
 */

type Seg = 0 | 1 | 2;
type Period = 'AM' | 'PM';

interface Parts {
  h: number | null;
  m: number | null;
  ap: Period | null;
}

interface Props
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type' | 'defaultValue'> {
  value: string;
  onChange: (value: string) => void;
  hour12?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

const subscribeNever = () => () => {};
const localeHour12 = () =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? true;

function fromValue(value: string, hour12: boolean): Parts {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return { h: null, m: null, ap: null };
  const H = Number(match[1]);
  const m = Number(match[2]);
  if (!hour12) return { h: H, m, ap: null };
  return { h: H % 12 || 12, m, ap: H < 12 ? 'AM' : 'PM' };
}

/** Null while incomplete; '' once every part is cleared. */
function toValue(p: Parts, hour12: boolean): string | null {
  if (p.h === null && p.m === null) return '';
  if (p.h === null || p.m === null || (hour12 && p.ap === null)) return null;
  const H = hour12 ? (p.h % 12) + (p.ap === 'PM' ? 12 : 0) : p.h;
  return `${pad(H)}:${pad(p.m)}`;
}

/** Period for an hour typed without one: 7–11 reads as morning, 12–6 as afternoon. */
const guessPeriod = (h: number): Period => (h >= 7 && h <= 11 ? 'AM' : 'PM');

const SEG_START = [0, 3, 6];

export default function TimeInput({ value, onChange, hour12: hour12Prop, onBlur, onFocus, className, name, ...rest }: Props) {
  const localeDefault = useSyncExternalStore(subscribeNever, localeHour12, () => true);
  const hour12 = hour12Prop ?? localeDefault;

  const inputRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState<Parts>(() => fromValue(value, hour12));
  const [active, setActive] = useState<Seg>(0);
  const [buffer, setBuffer] = useState('');
  const [focused, setFocused] = useState(false);

  // Follow the prop when it changes to something other than what's on screen.
  const [prev, setPrev] = useState({ value, hour12 });
  if (prev.value !== value || prev.hour12 !== hour12) {
    setPrev({ value, hour12 });
    if (toValue(parts, hour12) !== value || prev.hour12 !== hour12) {
      setParts(fromValue(value, hour12));
      setBuffer('');
    }
  }

  const lastSeg: Seg = hour12 ? 2 : 1;
  const hourMin = hour12 ? 1 : 0;
  const hourMax = hour12 ? 12 : 23;

  const emit = (next: Parts) => {
    setParts(next);
    const v = toValue(next, hour12);
    if (v !== null && v !== value) onChange(v);
  };

  /** Sets a typed hour, which is always 0–23; in 12h that also decides AM/PM when it can. */
  const withHour = (p: Parts, n: number): Parts => {
    if (!hour12) return { ...p, h: n };
    if (n === 0) return { ...p, h: 12, ap: 'AM' };
    if (n > 12) return { ...p, h: n - 12, ap: 'PM' };
    return { ...p, h: n, ap: p.ap ?? guessPeriod(n) };
  };

  /** Writes a half-typed part if it's valid on its own; drops it otherwise. */
  const flush = (p: Parts = parts): Parts => {
    if (!buffer) return p;
    const n = Number(buffer);
    setBuffer('');
    if (active === 0 && n <= 23) return withHour(p, n);
    if (active === 1 && n <= 59) return { ...p, m: n };
    return p;
  };

  const move = (to: number) => {
    emit(flush());
    setActive(Math.max(0, Math.min(lastSeg, to)) as Seg);
  };

  const typeDigit = (d: number) => {
    if (active === 2) return;
    const max = active === 0 ? 23 : 59;
    const set = (n: number) => (active === 0 ? withHour(parts, n) : { ...parts, m: n });
    const next = Number(buffer + d);

    if (buffer && next <= max) {
      setBuffer('');
      emit(set(next));
      if (active < lastSeg) setActive((active + 1) as Seg);
      return;
    }
    // A fresh first digit, either because nothing was typed yet or because the
    // two together don't make a valid number.
    if (d * 10 > max) {
      setBuffer('');
      emit(set(d));
      if (active < lastSeg) setActive((active + 1) as Seg);
    } else {
      setBuffer(String(d));
    }
  };

  const setPeriod = (ap: Period) => {
    emit({ ...flush(), ap });
  };

  const step = (dir: 1 | -1) => {
    const p = flush();
    if (active === 0) {
      const span = hourMax - hourMin + 1;
      const h = p.h === null ? (dir > 0 ? hourMin : hourMax) : ((p.h - hourMin + dir + span) % span) + hourMin;
      emit({ ...p, h, ap: hour12 ? (p.ap ?? guessPeriod(h)) : null });
    } else if (active === 1) {
      emit({ ...p, m: p.m === null ? (dir > 0 ? 0 : 59) : (p.m + dir + 60) % 60 });
    } else {
      emit({ ...p, ap: p.ap === 'AM' ? 'PM' : 'AM' });
    }
  };

  const clear = () => {
    if (buffer) {
      setBuffer('');
      return;
    }
    const key = (['h', 'm', 'ap'] as const)[active];
    if (parts[key] === null) {
      if (active > 0) setActive((active - 1) as Seg);
      return;
    }
    emit({ ...parts, [key]: null });
  };

  const paste = (text: string) => {
    const match = /^\s*(\d{1,2})[:.\s]?(\d{2})?\s*([ap])?\.?m?\.?\s*$/i.exec(text);
    if (!match) return;
    let H = Number(match[1]);
    const m = Number(match[2] ?? 0);
    const ap = match[3]?.toLowerCase();
    if (ap === 'p' && H < 12) H += 12;
    if (ap === 'a' && H === 12) H = 0;
    if (H > 23 || m > 59) return;
    setBuffer('');
    emit(fromValue(`${pad(H)}:${pad(m)}`, hour12));
  };

  // Every edit goes through here; the DOM value is never edited directly.
  const handlers = useRef({ typeDigit, setPeriod, move, clear, paste, active });
  useLayoutEffect(() => {
    handlers.current = { typeDigit, setPeriod, move, clear, paste, active };
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
      else if (/[aA]/.test(data)) h.setPeriod('AM');
      else if (/[pP]/.test(data)) h.setPeriod('PM');
      else if (/[:.\s]/.test(data)) h.move(h.active + 1);
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  const segText = (seg: Seg) => {
    if (seg === active && buffer) return buffer.padStart(2, '0');
    if (seg === 0) return parts.h === null ? '--' : pad(parts.h);
    if (seg === 1) return parts.m === null ? '--' : pad(parts.m);
    return parts.ap ?? '--';
  };
  const empty = parts.h === null && parts.m === null && !buffer;
  const display = empty ? '' : `${segText(0)}:${segText(1)}${hour12 ? ` ${segText(2)}` : ''}`;

  // Keep the active part highlighted, as a native time input does.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !focused || document.activeElement !== el) return;
    if (display) el.setSelectionRange(SEG_START[active], SEG_START[active] + 2);
  }, [active, display, focused]);

  const segAt = (pos: number): Seg => (pos < 3 ? 0 : pos < 6 || !hour12 ? 1 : 2);

  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={hour12 ? '--:-- --' : '--:--'}
        value={display}
        onChange={() => {}}
        className={`tabular-nums ${className ?? ''}`}
        onFocus={(e) => {
          setFocused(true);
          setActive(0);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          const p = flush();
          if (toValue(p, hour12) === null) setParts(fromValue(value, hour12));
          else emit(p);
          onBlur?.(e);
        }}
        onMouseUp={(e) => {
          const seg = segAt(e.currentTarget.selectionStart ?? 0);
          // Tapping AM/PM again toggles it — the only way on a numeric keypad.
          if (seg === 2 && active === 2 && parts.ap) setPeriod(parts.ap === 'AM' ? 'PM' : 'AM');
          if (seg !== active) move(seg);
          else if (display) e.currentTarget.setSelectionRange(SEG_START[seg], SEG_START[seg] + 2);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            move(active + (e.key === 'ArrowRight' ? 1 : -1));
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(e.key === 'ArrowUp' ? 1 : -1);
          }
          rest.onKeyDown?.(e);
        }}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}
