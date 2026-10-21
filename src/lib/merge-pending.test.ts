import { describe, expect, it } from 'vitest';
import { planPendingMerge, previewPendingMerge } from './merge-pending';

const ev = (id: number, start: string, end: string, title: string, isPending: number, recurrenceId: string | null = null) => ({
  id,
  startDatetime: `2026-10-15 ${start}:00`,
  endDatetime: `2026-10-15 ${end}:00`,
  title,
  isPending,
  recurrenceId,
});

describe('planPendingMerge', () => {
  it('folds the first pending event into a back-to-back approved one, ignoring case', () => {
    const plan = planPendingMerge([ev(1, '09:00', '10:00', 'Study', 0), ev(2, '10:00', '11:00', 'study ', 1)]);
    expect([...plan.newEnds]).toEqual([[1, '2026-10-15 11:00:00']]);
    expect([...plan.absorbed]).toEqual([2]);
  });

  it('chains a run of pending events and stops at a new name', () => {
    const plan = planPendingMerge([
      ev(1, '10:00', '11:00', 'a', 1),
      ev(2, '11:00', '12:00', 'a', 1),
      ev(3, '12:00', '13:00', 'b', 1),
      ev(4, '13:00', '14:00', 'b', 1),
    ]);
    expect([...plan.newEnds]).toEqual([
      [1, '2026-10-15 12:00:00'],
      [3, '2026-10-15 14:00:00'],
    ]);
    expect([...plan.absorbed]).toEqual([2, 4]);
  });

  it('never merges across a gap', () => {
    const plan = planPendingMerge([ev(1, '09:00', '10:00', 'a', 0), ev(2, '10:05', '11:00', 'a', 1)]);
    expect(plan.absorbed.size).toBe(0);
  });

  it('leaves recurring approved events alone', () => {
    const plan = planPendingMerge([ev(1, '09:00', '10:00', 'a', 0, 'series'), ev(2, '10:00', '11:00', 'a', 1)]);
    expect(plan.absorbed.size).toBe(0);
  });

  it('does nothing without pending events', () => {
    const plan = planPendingMerge([ev(1, '09:00', '10:00', 'a', 0), ev(2, '10:00', '11:00', 'a', 0)]);
    expect(plan.absorbed.size).toBe(0);
  });
});

describe('previewPendingMerge', () => {
  it('drops absorbed events and shows a grown approved event as pending', () => {
    const preview = previewPendingMerge([ev(1, '09:00', '10:00', 'a', 0), ev(2, '10:00', '11:00', 'a', 1)]);
    expect(preview).toEqual([{ ...ev(1, '09:00', '11:00', 'a', 1) }]);
  });

  it('returns the same array when nothing merges', () => {
    const events = [ev(1, '09:00', '10:00', 'a', 0)];
    expect(previewPendingMerge(events)).toBe(events);
  });
});
