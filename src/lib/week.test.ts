import { describe, expect, it } from 'vitest';
import { parseWeekStart, startOfWeek, weekdayOrder } from './week';

describe('parseWeekStart', () => {
  it('accepts the offered days', () => {
    expect(parseWeekStart('1')).toBe(1);
    expect(parseWeekStart('6')).toBe(6);
  });

  it('falls back to Sunday', () => {
    expect(parseWeekStart('3')).toBe(0);
    expect(parseWeekStart(undefined)).toBe(0);
    expect(parseWeekStart('junk')).toBe(0);
  });
});

describe('startOfWeek', () => {
  const wed = new Date(2026, 9, 14);

  it.each([
    [0, 11],
    [1, 12],
    [6, 10],
  ] as const)('week starting on %i', (weekStart, day) => {
    expect(startOfWeek(wed, weekStart)).toEqual(new Date(2026, 9, day));
  });

  it('is the day itself on the first day of the week', () => {
    expect(startOfWeek(new Date(2026, 9, 12), 1)).toEqual(new Date(2026, 9, 12));
  });
});

describe('weekdayOrder', () => {
  it('starts on the chosen day', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});
