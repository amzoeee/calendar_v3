import { shiftDateStr } from '@/lib/timezone';

export const DRAG_SNAP_MIN = 15;
// A plain click starts on the half hour it lands in and lasts an hour.
const CLICK_SNAP_MIN = 30;
const CLICK_LENGTH_MIN = 60;
const DAY_MIN = 24 * 60;

/** A span of one day column, in minutes from its midnight. `endMin` may be 1440. */
export interface MinuteRange {
  startMin: number;
  endMin: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The slot a drag starts in, snapped down. */
export function anchorMinute(min: number): number {
  return clamp(Math.floor(min / DRAG_SNAP_MIN) * DRAG_SNAP_MIN, 0, DAY_MIN - DRAG_SNAP_MIN);
}

/**
 * The range swept from the anchor slot to `min`, either direction. Always at
 * least one snap long and always covers the anchor slot.
 */
export function dragRange(anchor: number, min: number): MinuteRange {
  const cur = clamp(Math.round(min / DRAG_SNAP_MIN) * DRAG_SNAP_MIN, 0, DAY_MIN);
  if (cur > anchor) return { startMin: anchor, endMin: Math.max(cur, anchor + DRAG_SNAP_MIN) };
  return { startMin: Math.min(cur, anchor), endMin: anchor + DRAG_SNAP_MIN };
}

export function clickRange(min: number): MinuteRange {
  const startMin = clamp(Math.floor(min / CLICK_SNAP_MIN) * CLICK_SNAP_MIN, 0, DAY_MIN - CLICK_SNAP_MIN);
  return { startMin, endMin: Math.min(startMin + CLICK_LENGTH_MIN, DAY_MIN) };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Editor fields for a range on `date`; a range ending at midnight ends at 00:00 the next day. */
export function rangeToFields(date: string, { startMin, endMin }: MinuteRange) {
  const endsNextDay = endMin >= DAY_MIN;
  return {
    startDate: date,
    startTime: hhmm(startMin),
    endDate: endsNextDay ? shiftDateStr(date, 1) : date,
    endTime: hhmm(endsNextDay ? 0 : endMin),
  };
}

const toMin = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Where the draft sits in `date`'s column, or null if it starts on another
 * day. An end at or before the start shows an hour, as the server saves it.
 */
export function fieldsToRange(
  date: string,
  f: { startDate: string; startTime: string; endDate: string; endTime: string }
): MinuteRange | null {
  if (f.startDate !== date || !f.startTime) return null;
  const startMin = toMin(f.startTime);
  let endMin = f.endDate > date ? DAY_MIN : f.endDate === date && f.endTime ? toMin(f.endTime) : startMin;
  if (endMin <= startMin) endMin = Math.min(startMin + 60, DAY_MIN);
  return { startMin, endMin };
}
