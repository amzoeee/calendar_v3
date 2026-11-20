import { describe, expect, it } from 'vitest';
import { bucketCalendarTasks, type CalendarTaskRow } from './calendarTasks';

let nextId = 1;
const row = (extra: Partial<CalendarTaskRow>): CalendarTaskRow => ({
  id: nextId++,
  boardId: 1,
  title: 'Task',
  counterValue: null,
  dueDatetime: null,
  dueHasTime: 0,
  dueAsap: 0,
  completedAt: null,
  openSubtasks: 0,
  color: null,
  ...extra,
});

const week = { from: '2026-11-15', to: '2026-11-21', today: '2026-11-19' };
const titles = (byDay: ReturnType<typeof bucketCalendarTasks>, day: string) => (byDay[day] ?? []).map((t) => t.title);

describe('bucketCalendarTasks', () => {
  it('puts a day-only deadline on its day in the viewer’s timezone', () => {
    // Set in New York as Nov 18 23:59 → stored as Pacific 20:59.
    const rows = [row({ title: 'NY', dueDatetime: '2026-11-18 20:59:00' })];
    expect(titles(bucketCalendarTasks(rows, { ...week, timeZone: 'America/New_York' }), '2026-11-18')).toEqual(['NY']);
  });

  it('moves a late Pacific deadline to the next day further east', () => {
    const rows = [row({ title: 'Late', dueDatetime: '2026-11-18 22:00:00', dueHasTime: 1 })];
    const byDay = bucketCalendarTasks(rows, { ...week, timeZone: 'America/New_York' });
    expect(titles(byDay, '2026-11-19')).toEqual(['Late']);
    expect(byDay['2026-11-19'][0].time).toBe('1:00 AM');
  });

  it('shows open ASAP tasks on today, and drops done ones', () => {
    const rows = [
      row({ title: 'Asap', dueAsap: 1 }),
      row({ title: 'Asap done', dueAsap: 1, completedAt: '2026-11-18 10:00:00' }),
    ];
    expect(bucketCalendarTasks(rows, { ...week, timeZone: 'America/Los_Angeles' })).toEqual({
      '2026-11-19': [expect.objectContaining({ title: 'Asap', asap: true })],
    });
  });

  it('leaves out ASAP when today is outside the range', () => {
    const rows = [row({ dueAsap: 1 })];
    expect(bucketCalendarTasks(rows, { ...week, today: '2026-11-25', timeZone: 'UTC' })).toEqual({});
  });

  it('skips undated tasks and days outside the range', () => {
    const rows = [row({}), row({ dueDatetime: '2026-11-22 23:59:00' })];
    expect(bucketCalendarTasks(rows, { ...week, timeZone: 'America/Los_Angeles' })).toEqual({});
  });

  it('orders ASAP, timed, day-only, then done', () => {
    const day = '2026-11-19';
    const rows = [
      row({ title: 'done', dueDatetime: `${day} 08:00:00`, dueHasTime: 1, completedAt: `${day} 07:00:00` }),
      row({ title: 'day-only', dueDatetime: `${day} 23:59:00` }),
      row({ title: 'at 3', dueDatetime: `${day} 15:00:00`, dueHasTime: 1 }),
      row({ title: 'at 9', dueDatetime: `${day} 09:00:00`, dueHasTime: 1 }),
      row({ title: 'asap', dueAsap: 1 }),
    ];
    expect(titles(bucketCalendarTasks(rows, { ...week, timeZone: 'America/Los_Angeles' }), day)).toEqual([
      'asap',
      'at 9',
      'at 3',
      'day-only',
      'done',
    ]);
  });

  it('fills in a rolling counter', () => {
    const rows = [row({ title: 'PS {n}', counterValue: 4, dueDatetime: '2026-11-19 23:59:00' })];
    expect(titles(bucketCalendarTasks(rows, { ...week, timeZone: 'America/Los_Angeles' }), '2026-11-19')).toEqual(['PS 4']);
  });
});
