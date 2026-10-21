import { describe, expect, it } from 'vitest';
import { calculateOverlapColumns, type PositionedEvent } from './overlap';

let nextId = 1;
const ev = (start: string, end: string): PositionedEvent => ({
  id: nextId++,
  startDatetime: `2026-10-15 ${start}:00`,
  endDatetime: `2026-10-15 ${end}:00`,
  title: '',
  userId: 1,
  isPending: 0,
});

const layout = (events: PositionedEvent[]) =>
  calculateOverlapColumns(events).map((e) => [e.startDatetime.slice(11, 16), e.overlap_column, e.overlap_total]);

describe('calculateOverlapColumns', () => {
  it('returns [] for no events', () => {
    expect(calculateOverlapColumns([])).toEqual([]);
  });

  it('gives separate events a full column each', () => {
    expect(layout([ev('09:00', '10:00'), ev('11:00', '12:00')])).toEqual([
      ['09:00', 0, 1],
      ['11:00', 0, 1],
    ]);
  });

  it('treats back-to-back events as not overlapping', () => {
    expect(layout([ev('09:00', '10:00'), ev('10:00', '11:00')])).toEqual([
      ['09:00', 0, 1],
      ['10:00', 0, 1],
    ]);
  });

  it('puts overlapping events side by side, sorted by start', () => {
    expect(layout([ev('10:00', '12:00'), ev('09:00', '11:00')])).toEqual([
      ['09:00', 0, 2],
      ['10:00', 1, 2],
    ]);
  });

  it('reuses a column once it frees up within a chain', () => {
    expect(layout([ev('09:00', '11:00'), ev('10:00', '12:00'), ev('11:00', '13:00')])).toEqual([
      ['09:00', 0, 2],
      ['10:00', 1, 2],
      ['11:00', 0, 2],
    ]);
  });

  it('uses as many columns as events overlap at once', () => {
    expect(layout([ev('09:00', '12:00'), ev('09:30', '12:00'), ev('10:00', '12:00')]).map((r) => r[1])).toEqual([0, 1, 2]);
  });
});
