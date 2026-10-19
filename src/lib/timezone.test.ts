import { describe, expect, it } from 'vitest';
import {
  addHoursToDbString,
  browserDatetimeToServerDbString,
  convertDbString,
  dayStrOfInstant,
  dbStringToUtcMillis,
  formatClockTime,
  formatEventTimeRange,
  SERVER_TIMEZONE,
  shiftDateStr,
} from './timezone';

describe('browserDatetimeToServerDbString', () => {
  it('converts a browser wall clock into Pacific', () => {
    expect(browserDatetimeToServerDbString('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01 09:00:00');
  });

  it('crosses the date line', () => {
    expect(browserDatetimeToServerDbString('2026-01-16T08:00', 'Asia/Tokyo')).toBe('2026-01-15 15:00:00');
  });

  it('is a no-op for Pacific input', () => {
    expect(browserDatetimeToServerDbString('2026-03-08T03:30', SERVER_TIMEZONE)).toBe('2026-03-08 03:30:00');
  });
});

describe('convertDbString', () => {
  it('converts between zones', () => {
    expect(convertDbString('2026-01-15 23:00:00', SERVER_TIMEZONE, 'Asia/Tokyo')).toBe('2026-01-16 16:00:00');
  });

  it('round-trips', () => {
    const there = convertDbString('2026-11-01 12:15:00', SERVER_TIMEZONE, 'Europe/London');
    expect(convertDbString(there, 'Europe/London', SERVER_TIMEZONE)).toBe('2026-11-01 12:15:00');
  });
});

describe('dbStringToUtcMillis', () => {
  it('reads Pacific daylight time', () => {
    expect(dbStringToUtcMillis('2026-07-01 00:00:00')).toBe(Date.UTC(2026, 6, 1, 7));
  });

  it('reads Pacific standard time', () => {
    expect(dbStringToUtcMillis('2026-01-01 00:00:00')).toBe(Date.UTC(2026, 0, 1, 8));
  });
});

describe('dayStrOfInstant', () => {
  it('uses the given zone, not UTC', () => {
    expect(dayStrOfInstant(Date.UTC(2026, 0, 1, 6), SERVER_TIMEZONE)).toBe('2025-12-31');
    expect(dayStrOfInstant(Date.UTC(2026, 0, 1, 6), 'UTC')).toBe('2026-01-01');
  });
});

describe('shiftDateStr', () => {
  it('handles month, leap-year and year boundaries', () => {
    expect(shiftDateStr('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDateStr('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDateStr('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is unaffected by DST', () => {
    expect(shiftDateStr('2026-03-07', 2)).toBe('2026-03-09');
  });
});

describe('addHoursToDbString', () => {
  it('rolls over midnight and the year', () => {
    expect(addHoursToDbString('2026-12-31 23:30:00', 1)).toBe('2027-01-01 00:30:00');
  });

  it('handles negative hours', () => {
    expect(addHoursToDbString('2026-03-01 00:15:00', -1)).toBe('2026-02-28 23:15:00');
  });
});

describe('formatting', () => {
  it('pins the clock format to en-US', () => {
    expect(formatClockTime(new Date(Date.UTC(2026, 0, 1, 9, 5)))).toBe('09:05 AM');
  });

  it('dates both ends of a range that crosses midnight', () => {
    const start = new Date(Date.UTC(2026, 7, 12, 22));
    const end = new Date(Date.UTC(2026, 7, 13, 7));
    expect(formatEventTimeRange(start, end)).toBe('Aug 12 10:00 PM - Aug 13 07:00 AM');
  });

  it('leaves same-day ranges undated', () => {
    const start = new Date(Date.UTC(2026, 7, 12, 10));
    const end = new Date(Date.UTC(2026, 7, 12, 11, 30));
    expect(formatEventTimeRange(start, end)).toBe('10:00 AM - 11:30 AM');
  });
});
