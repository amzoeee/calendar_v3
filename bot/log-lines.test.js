import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { activityOf, collectLogLines, isLogLine, isMarker, mergeRepeats, sameTime } = createRequire(import.meta.url)(
  './log-lines.js'
);

const msg = (content, authorId = 'me', createdAt = 't') => ({ content, authorId, createdAt });

describe('isMarker', () => {
  it.each(['---', '———', '─── done', '  ----- Yesterday at 9:00 PM -----'])('%s is a marker', (line) => {
    expect(isMarker(line)).toBe(true);
  });

  it.each(['--', '930 study', 'a ---'])('%s is not', (line) => {
    expect(isMarker(line)).toBe(false);
  });
});

describe('isLogLine', () => {
  it.each(['930 study', '10:30 am breakfast', '1430 lunch', '0 sleep'])('%s', (line) => {
    expect(isLogLine(line)).toBe(true);
  });

  it.each(['study 930', '2400 nope', '930', 'hello'])('rejects %s', (line) => {
    expect(isLogLine(line)).toBe(false);
  });
});

describe('collectLogLines', () => {
  it('reads newest-first messages back to the last marker, chronologically', () => {
    const result = collectLogLines(
      [msg('1100 work\n1200 lunch', 'me', 't3'), msg('1000 study', 'me', 't2'), msg('---', 'bot', 't1'), msg('900 old')],
      'me'
    );
    expect(result.lines).toEqual(['1000 study', '1100 work', '1200 lunch']);
    expect(result.markerFound).toBe(true);
    expect(result.startAt).toBe('t1');
    expect(result.latest.line).toBe('1200 lunch');
  });

  it('only takes the given author’s lines, but stops at anyone’s marker', () => {
    const result = collectLogLines([msg('1000 mine'), msg('1100 theirs', 'them'), msg('---', 'them'), msg('900 old')], 'me');
    expect(result.lines).toEqual(['1000 mine']);
  });

  it('takes everyone’s lines for a null user and reports a missing marker', () => {
    const result = collectLogLines([msg('1000 a', 'x', 't2'), msg('900 b', 'y', 't1')], null);
    expect(result.lines).toEqual(['900 b', '1000 a']);
    expect(result.markerFound).toBe(false);
    expect(result.startAt).toBe('t1');
  });
});

describe('mergeRepeats', () => {
  it('keeps the last line of each run, since a line marks when it ended', () => {
    expect(mergeRepeats(['1400 study', '1500 Study', '1600 lunch', '1700 study'])).toEqual([
      '1500 Study',
      '1600 lunch',
      '1700 study',
    ]);
  });

  it('reads the activity case-insensitively', () => {
    expect(activityOf('930 am Study  ')).toBe('study');
  });
});

describe('sameTime', () => {
  it('treats a bare 1-12 as either half of the day', () => {
    expect(sameTime('630 a', '1830 b')).toBe(true);
    expect(sameTime('630 a', '630 pm b')).toBe(true);
  });

  it('is false for different times', () => {
    expect(sameTime('630 am a', '1830 b')).toBe(false);
    expect(sameTime('1400 a', '1500 b')).toBe(false);
  });
});
