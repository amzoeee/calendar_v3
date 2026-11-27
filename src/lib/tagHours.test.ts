import { describe, expect, it } from 'vitest';
import { defaultDay, groupTagHours, parseHoursMode } from './tagHours';

const tags = [
  { id: 1, name: 'Work', parentId: null },
  { id: 2, name: 'Meetings', parentId: 1 },
  { id: 3, name: 'Coding', parentId: 1 },
  { id: 4, name: 'Sleep', parentId: null },
];

describe('groupTagHours', () => {
  it('totals subtags under their parent', () => {
    expect(groupTagHours({ Meetings: 1, Work: 0.5, Coding: 3 }, tags)).toEqual([
      { root: 'Work', members: ['Coding', 'Meetings', 'Work'], total: 4.5, hasSubtags: true },
    ]);
  });

  it('groups a subtag whose parent has no hours', () => {
    expect(groupTagHours({ Meetings: 2 }, tags)).toEqual([
      { root: 'Work', members: ['Meetings'], total: 2, hasSubtags: true },
    ]);
  });

  it('sorts groups by total', () => {
    const roots = groupTagHours({ Meetings: 2, Sleep: 8, Coding: 3 }, tags).map((g) => g.root);
    expect(roots).toEqual(['Sleep', 'Work']);
  });

  it('keeps names that are not tags, such as Untagged', () => {
    expect(groupTagHours({ Untagged: 1 }, tags)).toEqual([
      { root: 'Untagged', members: ['Untagged'], total: 1, hasSubtags: false },
    ]);
  });

  it('is empty with no hours', () => {
    expect(groupTagHours({}, tags)).toEqual([]);
  });
});

describe('parseHoursMode', () => {
  it('falls back to range', () => {
    expect(parseHoursMode('day')).toBe('day');
    expect(parseHoursMode(undefined)).toBe('range');
    expect(parseHoursMode('junk')).toBe('range');
  });
});

describe('defaultDay', () => {
  const days = ['2026-11-23', '2026-11-24', '2026-11-25'];

  it.each([
    ['today when shown', '2026-11-24', '2026-11-24'],
    ['the last day of a past range', '2026-12-30', '2026-11-25'],
    ['the first day of a future range', '2026-11-01', '2026-11-23'],
  ])('is %s', (_, today, expected) => {
    expect(defaultDay(days, today)).toBe(expected);
  });

  it('is the weekday before a hidden weekend', () => {
    expect(defaultDay(['2026-11-20', '2026-11-23'], '2026-11-22')).toBe('2026-11-20');
  });

  it('is undefined with no days', () => {
    expect(defaultDay([], '2026-11-24')).toBeUndefined();
  });
});
