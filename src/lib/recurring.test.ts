import { describe, expect, it, vi } from 'vitest';

// The module also holds the DB writers; only the pure expansion is under test.
vi.mock('../db', () => ({ db: {} }));

const { expandRrule } = await import('./recurring');

const starts = (rrule: string, start = '2026-10-12 09:00:00', end = '2026-10-12 10:00:00') =>
  expandRrule(start, end, rrule).map(([s]) => s.slice(0, 10));

describe('expandRrule', () => {
  it('honours COUNT', () => {
    expect(starts('FREQ=DAILY;COUNT=3')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('keeps each instance’s duration', () => {
    expect(expandRrule('2026-10-12 23:30:00', '2026-10-13 00:15:00', 'FREQ=DAILY;COUNT=2')).toEqual([
      ['2026-10-12 23:30:00', '2026-10-13 00:15:00'],
      ['2026-10-13 23:30:00', '2026-10-14 00:15:00'],
    ]);
  });

  it('includes the UNTIL date', () => {
    expect(starts('FREQ=DAILY;UNTIL=20261014')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('steps by INTERVAL', () => {
    expect(starts('FREQ=DAILY;INTERVAL=2;COUNT=3')).toEqual(['2026-10-12', '2026-10-14', '2026-10-16']);
  });

  it('expands weekly BYDAY', () => {
    // 2026-10-12 is a Monday.
    expect(starts('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4')).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-19',
      '2026-10-21',
    ]);
  });

  it('repeats weekly on the start day without BYDAY', () => {
    expect(starts('FREQ=WEEKLY;COUNT=2')).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('skips months without the start day, as RFC 5545 and Google Calendar do', () => {
    expect(starts('FREQ=MONTHLY;COUNT=3', '2026-01-31 09:00:00', '2026-01-31 10:00:00')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('repeats yearly', () => {
    expect(starts('FREQ=YEARLY;COUNT=2')).toEqual(['2026-10-12', '2027-10-12']);
  });

  it('caps open-ended rules', () => {
    expect(expandRrule('2026-10-12 09:00:00', '2026-10-12 10:00:00', 'FREQ=DAILY', 5)).toHaveLength(5);
  });
});
