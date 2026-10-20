import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

// The module also holds the DB-backed staging; only the parsers are under test.
vi.mock('../db', () => ({ db: {} }));

const { getNextOccurrence, parseDiscordDate, parseShorthandTime } = await import('./discord-log');
const { isValidShorthandTime } = createRequire(import.meta.url)('../../bot/log-lines.js');

describe('parseShorthandTime', () => {
  it.each([
    ['9', undefined, { hour: 9, minute: 0, exact24h: null }],
    ['930', undefined, { hour: 9, minute: 30, exact24h: null }],
    ['1430', undefined, { hour: 14, minute: 30, exact24h: 14 }],
    ['10:30', undefined, { hour: 10, minute: 30, exact24h: null }],
    ['0145', undefined, { hour: 1, minute: 45, exact24h: 1 }],
    ['0', undefined, { hour: 0, minute: 0, exact24h: 0 }],
    ['12', 'am', { hour: 12, minute: 0, exact24h: 0 }],
    ['12', 'pm', { hour: 12, minute: 0, exact24h: 12 }],
    ['730', 'PM', { hour: 7, minute: 30, exact24h: 19 }],
  ])('%s %s', (time, ampm, expected) => {
    expect(parseShorthandTime(time, ampm)).toEqual(expected);
  });

  it('reads a leading 0 as ambiguous when 24h is off', () => {
    expect(parseShorthandTime('0145', undefined, false)).toEqual({ hour: 1, minute: 45, exact24h: null });
  });

  it.each(['2400', '960', '12345', 'ab'])('rejects %s', (time) => {
    expect(parseShorthandTime(time)).toBeNull();
  });

  it('agrees with the bot on which times are valid', () => {
    const candidates: string[] = [];
    for (let len = 1; len <= 4; len++) {
      for (let n = 0; n < 10 ** len; n++) candidates.push(String(n).padStart(len, '0'));
    }
    for (let h = 0; h < 30; h++) for (let m = 0; m < 70; m += 5) candidates.push(`${h}:${String(m).padStart(2, '0')}`);

    const disagreements = candidates.filter((t) => (parseShorthandTime(t) !== null) !== isValidShorthandTime(t));
    expect(disagreements).toEqual([]);
  });
});

describe('parseDiscordDate', () => {
  it('reads a dated Discord header', () => {
    expect(parseDiscordDate('zoe — 10/18/2026 9:00 PM')).toBe('2026-10-18');
    expect(parseDiscordDate('zoe - 1/2/26 9:00 AM')).toBe('2026-01-02');
  });

  it('ignores lines that are not headers', () => {
    expect(parseDiscordDate('930 study')).toBeNull();
    expect(parseDiscordDate('lunch - with friends')).toBeNull();
  });
});

describe('getNextOccurrence', () => {
  const at = (pacific: string) => new Date(Date.parse(`${pacific}-07:00`));
  const iso = (d: Date) => d.toISOString();

  it('picks the next matching clock time after the base', () => {
    expect(iso(getNextOccurrence(at('2026-07-01T08:00'), 9, 0, null))).toBe(iso(at('2026-07-01T09:00')));
    expect(iso(getNextOccurrence(at('2026-07-01T10:00'), 9, 0, null))).toBe(iso(at('2026-07-01T21:00')));
  });

  it('rolls an exact 24h time to the next day', () => {
    expect(iso(getNextOccurrence(at('2026-07-01T23:00'), 1, 30, 1))).toBe(iso(at('2026-07-02T01:30')));
  });

  it('reads the typed time in the browser’s zone', () => {
    // 9am New York is 6am Pacific.
    expect(iso(getNextOccurrence(at('2026-07-01T05:00'), 9, 0, 9, 'America/New_York'))).toBe(iso(at('2026-07-01T06:00')));
  });
});
