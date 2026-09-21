'use client';

import React, { useRef } from 'react';
import { flushSync } from 'react-dom';

/**
 * A native date input that accepts a date with the year left blank: leave the
 * year showing `----`, press Enter, and it fills in the current year.
 *
 * The browser gives us nothing to read here — `value` is '' until every
 * segment is filled, and there's no API for the half-typed one — so the month
 * and day come from two places:
 *
 *  - the digits, followed as they're typed — but only when we know which
 *    segment typing began in, since a click can start it anywhere; and
 *  - the last complete date the field itself held, which is what's still on
 *    screen when only the year has been cleared.
 *
 * The second is what makes this work on a pre-filled field, where clearing the
 * year is how you get to `09/07/----` in the first place. It's only trusted
 * while nothing has been typed since — once digits land in a segment we can't
 * identify, we'd rather fill nothing than fill the wrong thing.
 */

type Segment = 'year' | 'month' | 'day';

interface MonthDay {
  month: number;
  day: number;
}

/** Segment layout follows the locale: en-US shows MM/DD/YYYY, much of Europe DD/MM/YYYY. */
function segmentOrder(): Segment[] {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .map((p) => p.type)
    .filter((t): t is Segment => t === 'year' || t === 'month' || t === 'day');
}

/**
 * The smallest first digit that leaves no room for a second one, so the
 * browser moves to the next segment: "9" can only be September, while "1"
 * waits to see whether it's January or December.
 */
const ADVANCES_ON: Record<Segment, number> = { month: 2, day: 4, year: Infinity };

interface Entry {
  index: number;
  digits: string;
  month: number | null;
  day: number | null;
  /** Set once a digit lands in the year, so a half-typed year isn't overwritten. */
  yearTouched: boolean;
  /** Any digit typed since the field last held a complete date. */
  typed: boolean;
  /** Whether `index` is trustworthy — false after a click into the middle of the field. */
  indexKnown: boolean;
  /** A key changed a segment to something we can't read — stop guessing. */
  blind: boolean;
}

const emptyEntry = (): Entry => ({
  index: 0,
  digits: '',
  month: null,
  day: null,
  yearTouched: false,
  typed: false,
  indexKnown: true,
  blind: false,
});

const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar date — rejects the 02/30s that pass a range check. */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Whether a click landed in the field's first segment, which is the only way
 * to know where typing is about to start. Measured against the input's own
 * font: a click past the first separator could be any segment, and guessing
 * would mean filling in a date the field never showed.
 *
 * The browser pads each segment's box a little, so this underestimates the
 * first one — erring towards "don't know", which only costs the fill.
 */
let measureCtx: CanvasRenderingContext2D | null = null;

function clickedFirstSegment(el: HTMLInputElement, clientX: number): boolean {
  const ctx = (measureCtx ??= document.createElement('canvas').getContext('2d'));
  if (!ctx) return false;

  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const inset =
    parseFloat(style.paddingLeft || '0') + parseFloat(style.borderLeftWidth || '0');
  const x = clientX - rect.left - inset;
  if (x < 0) return false;

  ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  return x <= ctx.measureText('00').width + ctx.measureText('/').width / 2;
}

function monthDayOf(value: string): MonthDay | null {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return match ? { month: Number(match[1]), day: Number(match[2]) } : null;
}

/**
 * Write a value the way a keystroke would. React installs its own setter on
 * the node to track changes, so assigning `el.value` leaves it believing
 * nothing happened and `onChange` never fires — the prototype's setter is the
 * one that goes through.
 */
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function DateInput(props: React.ComponentPropsWithoutRef<'input'>) {
  const { onKeyDown, onFocus, onPointerDown, ...rest } = props;
  const entry = useRef<Entry>(emptyEntry());
  const lastComplete = useRef<MonthDay | null>(null);
  // Where the click that is about to focus the field landed. Null when focus
  // arrives some other way — tab or script, which both start at the first
  // segment.
  const pendingIndexKnown = useRef<boolean | null>(null);

  const order = useRef<Segment[] | null>(null);
  const getOrder = () => (order.current ??= segmentOrder());

  /** Feed one digit through the same segment-advancing rules the field itself uses. */
  const takeDigit = (digit: string) => {
    const state = entry.current;
    state.typed = true;

    const segment = state.indexKnown ? getOrder()[state.index] : undefined;
    if (!segment) return;
    if (segment === 'year') {
      state.yearTouched = true;
      return;
    }

    state.digits += digit;
    const value = Number(state.digits);
    if (state.digits.length < 2 && value < ADVANCES_ON[segment]) return;

    if (segment === 'month') state.month = value;
    else state.day = value;
    state.index += 1;
    state.digits = '';
  };

  /** Commit whatever is half-typed and move on, the way `/` or → does in the field. */
  const nextSegment = () => {
    const state = entry.current;
    if (state.digits !== '') {
      const segment = getOrder()[state.index];
      const value = Number(state.digits);
      if (segment === 'month') state.month = value;
      if (segment === 'day') state.day = value;
      state.digits = '';
    }
    state.index = Math.min(state.index + 1, getOrder().length - 1);
  };

  /** Forget the segment the caret is on — it's about to be blank on screen too. */
  const clearSegment = () => {
    const state = entry.current;
    const segment = getOrder()[state.index];
    state.digits = '';
    if (segment === 'month') state.month = null;
    if (segment === 'day') state.day = null;
    if (segment === 'year') state.yearTouched = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;

    // A complete date on screen beats anything inferred: remember it and start
    // the digit tracking over from it.
    if (el.value !== '') {
      lastComplete.current = monthDayOf(el.value);
      entry.current = emptyEntry();
    }
    const state = entry.current;

    if (e.key === 'Enter') {
      if (el.value === '' && !state.blind) {
        const typedParts =
          state.indexKnown && state.month != null && state.day != null && !state.yearTouched
            ? { month: state.month, day: state.day }
            : null;
        // Nothing typed since the field went incomplete, so what it showed
        // before is still on screen apart from the segment that was cleared.
        const remembered = state.typed ? null : lastComplete.current;
        const parts = typedParts ?? remembered;
        const year = new Date().getFullYear();

        if (parts && isRealDate(year, parts.month, parts.day)) {
          // Flushed synchronously: a consumer's own Enter handler runs right
          // after this one and often reads the value back (commit on blur), so
          // it has to see the date we just wrote rather than the empty field.
          const filled = `${year}-${pad(parts.month)}-${pad(parts.day)}`;
          flushSync(() => setNativeValue(el, filled));
          lastComplete.current = parts;
          entry.current = emptyEntry();
        }
      }
    } else if (/^\d$/.test(e.key)) {
      takeDigit(e.key);
    } else if (['/', '-', '.', ' ', 'ArrowRight'].includes(e.key)) {
      nextSegment();
    } else if (e.key === 'ArrowLeft') {
      state.digits = '';
      state.index = Math.max(state.index - 1, 0);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      clearSegment();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // These set the segment to something we never see. Anything we'd fill in
      // from here would be a guess.
      state.blind = true;
    }

    onKeyDown?.(e);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const known = clickedFirstSegment(el, e.clientX);
    if (document.activeElement === el) {
      // Moving the caret inside a field that's already focused fires no focus
      // event, so the reset has to happen here.
      entry.current = emptyEntry();
      entry.current.indexKnown = known;
      lastComplete.current = monthDayOf(el.value) ?? lastComplete.current;
    } else {
      pendingIndexKnown.current = known;
    }
    onPointerDown?.(e);
  };

  return (
    <input
      {...rest}
      type="date"
      onPointerDown={handlePointerDown}
      onFocus={(e) => {
        entry.current = emptyEntry();
        entry.current.indexKnown = pendingIndexKnown.current ?? true;
        pendingIndexKnown.current = null;
        lastComplete.current = monthDayOf(e.currentTarget.value);
        onFocus?.(e);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
