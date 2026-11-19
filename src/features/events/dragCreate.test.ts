import { describe, expect, it } from 'vitest';
import { anchorMinute, clickRange, dragRange, fieldsToRange, rangeToFields } from './dragCreate';

describe('dragRange', () => {
  it('sweeps down from the anchor slot in 15-minute steps', () => {
    expect(dragRange(540, 600)).toEqual({ startMin: 540, endMin: 600 });
    expect(dragRange(540, 607)).toEqual({ startMin: 540, endMin: 600 });
    expect(dragRange(540, 608)).toEqual({ startMin: 540, endMin: 615 });
  });

  it('keeps the anchor slot when dragging up', () => {
    expect(dragRange(540, 480)).toEqual({ startMin: 480, endMin: 555 });
  });

  it('is never shorter than one slot', () => {
    expect(dragRange(540, 541)).toEqual({ startMin: 540, endMin: 555 });
  });

  it('clamps to the day', () => {
    expect(dragRange(1380, 2000)).toEqual({ startMin: 1380, endMin: 1440 });
    expect(dragRange(30, -50)).toEqual({ startMin: 0, endMin: 45 });
  });
});

describe('anchorMinute', () => {
  it('snaps down and leaves room for one slot', () => {
    expect(anchorMinute(554)).toBe(540);
    expect(anchorMinute(1439)).toBe(1425);
  });
});

describe('clickRange', () => {
  it('is an hour from the half hour clicked', () => {
    expect(clickRange(555)).toEqual({ startMin: 540, endMin: 600 });
    expect(clickRange(575)).toEqual({ startMin: 570, endMin: 630 });
  });

  it('stops at midnight', () => {
    expect(clickRange(1430)).toEqual({ startMin: 1410, endMin: 1440 });
  });
});

describe('rangeToFields', () => {
  it('formats times on the same day', () => {
    expect(rangeToFields('2026-11-19', { startMin: 545, endMin: 615 })).toEqual({
      startDate: '2026-11-19',
      startTime: '09:05',
      endDate: '2026-11-19',
      endTime: '10:15',
    });
  });

  it('ends at midnight the next day', () => {
    expect(rangeToFields('2026-12-31', { startMin: 1380, endMin: 1440 })).toMatchObject({
      endDate: '2027-01-01',
      endTime: '00:00',
    });
  });
});

describe('fieldsToRange', () => {
  const f = (startDate: string, startTime: string, endDate: string, endTime: string) => ({
    startDate,
    startTime,
    endDate,
    endTime,
  });

  it('round-trips rangeToFields', () => {
    const r = { startMin: 1380, endMin: 1440 };
    expect(fieldsToRange('2026-11-19', rangeToFields('2026-11-19', r))).toEqual(r);
  });

  it('is null in another day’s column', () => {
    expect(fieldsToRange('2026-11-20', f('2026-11-19', '09:00', '2026-11-19', '10:00'))).toBeNull();
  });

  it('shows an hour when the end is not after the start', () => {
    expect(fieldsToRange('2026-11-19', f('2026-11-19', '09:00', '2026-11-19', '08:00'))).toEqual({
      startMin: 540,
      endMin: 600,
    });
  });
});
