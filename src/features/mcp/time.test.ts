import { describe, expect, it } from 'vitest';
import { formatToolTime, parseToolTime } from './time';

describe('parseToolTime', () => {
  it('reads wall clock in the given zone', () => {
    expect(parseToolTime('2026-11-24T09:00', 'America/New_York')).toBe('2026-11-24 06:00:00');
  });

  it('reads a bare date as midnight', () => {
    expect(parseToolTime('2026-11-24', 'America/Los_Angeles')).toBe('2026-11-24 00:00:00');
  });

  it('honours an explicit offset over the zone', () => {
    expect(parseToolTime('2026-11-24T09:00Z', 'Asia/Tokyo')).toBe('2026-11-24 01:00:00');
  });

  it('rejects anything else', () => {
    expect(() => parseToolTime('tuesday 9am', 'America/Los_Angeles')).toThrow();
  });
});

describe('formatToolTime', () => {
  it('writes the zone offset', () => {
    expect(formatToolTime('2026-11-24 06:00:00', 'America/New_York')).toBe('2026-11-24T09:00-05:00');
  });

  it('handles half-hour zones and DST', () => {
    expect(formatToolTime('2026-07-01 12:00:00', 'Asia/Kolkata')).toBe('2026-07-02T00:30+05:30');
    expect(formatToolTime('2026-07-01 12:00:00', 'America/Los_Angeles')).toBe('2026-07-01T12:00-07:00');
  });

  it('keeps the offset whole when the time has seconds', () => {
    expect(formatToolTime('2026-11-24 06:00:59', 'America/Los_Angeles')).toBe('2026-11-24T06:00-08:00');
  });

  it('round-trips through parseToolTime', () => {
    const db = '2026-03-08 03:30:00';
    expect(parseToolTime(formatToolTime(db, 'Europe/London'), 'Asia/Tokyo')).toBe(db);
  });
});
