import { describe, expect, it } from 'vitest';
import {
  computeRemindAt,
  displayTitle,
  dueState,
  localRemindTime,
  postponeLabel,
  repeatLabel,
  splitOffset,
  TIMED_UNITS,
} from './taskSchedule';

const LA = 'America/Los_Angeles';

describe('computeRemindAt', () => {
  it('subtracts elapsed minutes', () => {
    expect(computeRemindAt('2026-07-01 10:00:00', 30, null, null, LA)).toBe('2026-07-01 09:30:00');
  });

  it('counts minutes as real time across the spring-forward gap', () => {
    // 03:30 PDT minus 2 hours of real time is 00:30 PST.
    expect(computeRemindAt('2026-03-08 03:30:00', 120, null, null, LA)).toBe('2026-03-08 00:30:00');
  });

  it('steps calendar days and keeps the clock time across DST', () => {
    expect(computeRemindAt('2026-03-09 18:00:00', null, 1, '18:00', LA)).toBe('2026-03-08 18:00:00');
  });

  it('reads the day before in the viewer’s own calendar', () => {
    // Due 05:00 on the 21st in London. The stored 01:00 Pacific reads as 09:00 there,
    // so a day before is 09:00 on the 20th London, which is 01:00 on the 20th Pacific.
    expect(computeRemindAt('2026-10-20 21:00:00', null, 1, '01:00', 'Europe/London')).toBe('2026-10-20 01:00:00');
  });

  it('is null without a deadline or an offset', () => {
    expect(computeRemindAt(null, 30, null, null, LA)).toBeNull();
    expect(computeRemindAt('2026-07-01 10:00:00', null, null, null, LA)).toBeNull();
  });
});

describe('localRemindTime', () => {
  it('is the stored time in Pacific', () => {
    expect(localRemindTime('09:00', '2026-07-01 10:00:00', LA)).toBe('09:00');
  });

  it('converts to the viewer’s zone', () => {
    expect(localRemindTime('09:00', '2026-07-01 10:00:00', 'America/New_York')).toBe('12:00');
  });
});

describe('dueState', () => {
  it.each([
    ['2026-10-17', 'overdue'],
    ['2026-10-18', 'today'],
    ['2026-10-20', 'soon'],
    ['2026-10-21', 'later'],
  ])('%s', (due, state) => {
    expect(dueState(due, '2026-10-18')).toBe(state);
  });
});

describe('splitOffset', () => {
  it('uses the largest unit that divides evenly', () => {
    const { amount, unit } = splitOffset(120, TIMED_UNITS);
    expect(amount).toBe(2);
    expect(unit.size).toBe(60);
  });

  it('falls back to the smallest unit', () => {
    expect(splitOffset(45, TIMED_UNITS)).toMatchObject({ amount: 45, unit: TIMED_UNITS[0] });
  });
});

describe('repeat labels', () => {
  it('names the picker’s rules', () => {
    expect(repeatLabel('FREQ=WEEKLY;INTERVAL=2')).toBe('Every 2 weeks');
    expect(repeatLabel('FREQ=WEEKLY;BYDAY=MO')).toBe('Repeats');
    expect(repeatLabel(null)).toBeNull();
  });

  it('reads the postpone step out of the rule', () => {
    expect(postponeLabel('FREQ=WEEKLY;INTERVAL=2')).toBe('+2 weeks');
    expect(postponeLabel('freq=daily')).toBe('+1 day');
    expect(postponeLabel('FREQ=HOURLY')).toBeNull();
    expect(postponeLabel('FREQ=MONTHLY;INTERVAL=0')).toBeNull();
  });
});

describe('displayTitle', () => {
  it('substitutes the counter', () => {
    expect(displayTitle('day {n} of {n}', 3)).toBe('day 3 of 3');
    expect(displayTitle('day {n}', null)).toBe('day {n}');
  });
});
