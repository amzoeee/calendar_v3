import { describe, expect, it } from 'vitest';
import { groupTagHours } from './tagHours';

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
