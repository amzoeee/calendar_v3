'use client';

import React, { useRef } from 'react';
import { flushSync } from 'react-dom';

/**
 * A native date input that accepts a date with the year left blank: type
 * 09/07 and press Enter and it fills in the current year.
 *
 * The browser gives us nothing to work with here — `value` stays '' until
 * every segment is filled, and there's no API for reading a half-typed one —
 * so this follows the digits as they're typed and reconstructs what's in the
 * field. Only ever used to fill an *empty* field, so a fully typed date is
 * never second-guessed.
 */

type Segment = 'year' | 'month' | 'day';

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
  /** Set once anything lands in the year, so a half-typed year isn't overwritten. */
  yearTouched: boolean;
}

const emptyEntry = (): Entry => ({ index: 0, digits: '', month: null, day: null, yearTouched: false });

const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar date — rejects the 02/30s that pass a range check. */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
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
  const { onKeyDown, onFocus, ...rest } = props;
  const entry = useRef<Entry>(emptyEntry());

  const order = useRef<Segment[] | null>(null);
  const getOrder = () => (order.current ??= segmentOrder());

  /** Feed one digit through the same segment-advancing rules the field itself uses. */
  const takeDigit = (digit: string) => {
    const state = entry.current;
    const segment = getOrder()[state.index];
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const state = entry.current;

    if (e.key === 'Enter') {
      const year = new Date().getFullYear();
      if (
        el.value === '' &&
        !state.yearTouched &&
        state.month != null &&
        state.day != null &&
        isRealDate(year, state.month, state.day)
      ) {
        // Flushed synchronously: a consumer's own Enter handler runs right
        // after this one and often reads the value back (commit on blur), so
        // it has to see the date we just wrote rather than the empty field.
        const filled = `${year}-${pad(state.month)}-${pad(state.day)}`;
        flushSync(() => setNativeValue(el, filled));
        entry.current = emptyEntry();
      }
    } else if (/^\d$/.test(e.key)) {
      takeDigit(e.key);
    } else if (['/', '-', '.', ' ', 'ArrowRight'].includes(e.key)) {
      // Explicit "next segment" — whatever's half-typed stays as it is.
      if (state.digits !== '') {
        const segment = getOrder()[state.index];
        const value = Number(state.digits);
        if (segment === 'month') state.month = value;
        if (segment === 'day') state.day = value;
        state.digits = '';
        state.index += 1;
      }
    } else if (!['Tab', 'Shift', 'Meta', 'Control', 'Alt', 'Escape'].includes(e.key)) {
      // Arrows, backspace, anything else that edits a segment out from under
      // us: stop guessing rather than guess wrong.
      entry.current = emptyEntry();
    }

    onKeyDown?.(e);
  };

  return (
    <input
      {...rest}
      type="date"
      onFocus={(e) => {
        entry.current = emptyEntry();
        onFocus?.(e);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
