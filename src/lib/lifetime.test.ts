import { describe, expect, it } from 'vitest';
import { columnOfDate, parseRange, rangeColumns, rangeSearch, sliceEvents, type LifetimeEvents } from './lifetime';

describe('parseRange', () => {
  it('reads presets and custom dates', () => {
    expect(parseRange({})).toEqual({ kind: 'all' });
    expect(parseRange({ range: 'year' })).toEqual({ kind: 'year' });
    expect(parseRange({ from: '2026-08-16', to: '2026-10-28' })).toEqual({
      kind: 'custom',
      from: '2026-08-16',
      to: '2026-10-28',
    });
  });

  it('swaps reversed dates and ignores malformed ones', () => {
    expect(parseRange({ from: '2026-10-28', to: '2026-08-16' })).toEqual({
      kind: 'custom',
      from: '2026-08-16',
      to: '2026-10-28',
    });
    expect(parseRange({ from: '2026-8-16', to: '2026-10-28' })).toEqual({ kind: 'all' });
  });

  it('round-trips through rangeSearch', () => {
    const r = { kind: 'custom', from: '2026-01-02', to: '2026-03-04' } as const;
    const q = new URLSearchParams(rangeSearch(r));
    expect(parseRange(Object.fromEntries(q))).toEqual(r);
  });
});

describe('rangeColumns', () => {
  const today = columnOfDate('2026-10-28');

  it('runs all time from the first event to today', () => {
    expect(rangeColumns({ kind: 'all' }, columnOfDate('2025-09-07'), today)).toEqual({
      firstDay: columnOfDate('2025-09-07'),
      lastDay: today,
    });
  });

  it('starts this year on January 1', () => {
    expect(rangeColumns({ kind: 'year' }, columnOfDate('2025-09-07'), today)).toEqual({
      firstDay: columnOfDate('2026-01-01'),
      lastDay: today,
    });
  });

  it('clamps a custom end to today', () => {
    const r = { kind: 'custom', from: '2026-08-16', to: '2026-12-31' } as const;
    expect(rangeColumns(r, 0, today)).toEqual({ firstDay: columnOfDate('2026-08-16'), lastDay: today });
  });
});

describe('sliceEvents', () => {
  it('keeps events starting inside the range, with title and tag indices intact', () => {
    const data: LifetimeEvents = {
      titles: ['a', 'b'],
      tagNames: ['t'],
      ids: [1, 2, 3],
      starts: [0, 0, 0],
      durations: [10, 20, 30],
      titleIdx: [0, 1, 1],
      tagIdx: [0, -1, 0],
    };
    const sliced = sliceEvents(data, Int32Array.from([5, 6, 8]), 6, 8);
    expect(sliced.ids).toEqual([2, 3]);
    expect(sliced.durations).toEqual([20, 30]);
    expect(sliced.titleIdx).toEqual([1, 1]);
    expect(sliced.titles).toBe(data.titles);
  });
});
