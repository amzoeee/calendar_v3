import { describe, expect, it } from 'vitest';
import {
  UNTAGGED_COLOR,
  contrastTextClass,
  hourLabel,
  positionEventsForDay,
  type EventRowLike,
} from './positionEvents';

// Tests run with TZ=UTC, so local time is UTC. Event strings are Pacific:
// PDT (summer) is UTC-7, so Pacific 09:00 is 16:00 local; PST (winter) is UTC-8.
const JUNE_15 = new Date(2026, 5, 15);
const JUNE_16 = new Date(2026, 5, 16);

let nextId = 1;
const ev = (start: string, end: string, extra: Partial<EventRowLike> = {}): EventRowLike => ({
  id: nextId++,
  startDatetime: start,
  endDatetime: end,
  title: 'Event',
  userId: 1,
  isPending: 0,
  ...extra,
});

type Tags = Parameters<typeof positionEventsForDay>[2];
const noTags: Tags = [];

describe('positionEventsForDay', () => {
  it('returns [] for no events', () => {
    expect(positionEventsForDay([], JUNE_15, noTags, 'child')).toEqual([]);
  });

  it('positions an event in minutes from local midnight', () => {
    const [e] = positionEventsForDay([ev('2026-06-15 09:00:00', '2026-06-15 10:30:00')], JUNE_15, noTags, 'child');
    expect(e.top_position).toBe(16 * 60);
    expect(e.height).toBe(90);
    expect(e.duration_minutes).toBe(90);
  });

  it('applies the winter (PST) offset', () => {
    const [e] = positionEventsForDay([ev('2026-01-15 09:00:00', '2026-01-15 10:00:00')], new Date(2026, 0, 15), noTags, 'child');
    expect(e.top_position).toBe(17 * 60);
  });

  it('formats times with the pinned en-US format', () => {
    const [e] = positionEventsForDay([ev('2026-06-15 09:00:00', '2026-06-15 10:30:00')], JUNE_15, noTags, 'child');
    expect(e.start_time).toBe('04:00 PM');
    expect(e.end_time).toBe('05:30 PM');
    expect(e.time_range).toBe('04:00 PM - 05:30 PM');
    expect(e.start_datetime_local).toBe('2026-06-15T16:00');
    expect(e.end_datetime_local).toBe('2026-06-15T17:30');
  });

  it('keeps the original fields on the result', () => {
    const [e] = positionEventsForDay(
      [ev('2026-06-15 09:00:00', '2026-06-15 10:00:00', { description: 'notes', tag: 'work', rrule: 'FREQ=DAILY', recurrenceId: 'r1' })],
      JUNE_15,
      noTags,
      'child'
    );
    expect(e).toMatchObject({
      title: 'Event',
      description: 'notes',
      tag: 'work',
      rrule: 'FREQ=DAILY',
      recurrenceId: 'r1',
      startDatetime: '2026-06-15 09:00:00',
      endDatetime: '2026-06-15 10:00:00',
    });
  });

  describe('events outside the day', () => {
    it('drops events on other days', () => {
      const events = [
        ev('2026-06-14 09:00:00', '2026-06-14 10:00:00'),
        ev('2026-06-16 09:00:00', '2026-06-16 10:00:00'),
      ];
      expect(positionEventsForDay(events, JUNE_15, noTags, 'child')).toEqual([]);
    });

    it('drops an event ending exactly at the start of the day', () => {
      // Pacific 16:00-17:00 on the 14th is 23:00-00:00 local.
      expect(positionEventsForDay([ev('2026-06-14 16:00:00', '2026-06-14 17:00:00')], JUNE_15, noTags, 'child')).toEqual([]);
    });

    it('drops an event starting exactly at the end of the day', () => {
      // Pacific 17:00 is 00:00 local on the next day.
      expect(positionEventsForDay([ev('2026-06-15 17:00:00', '2026-06-15 18:00:00')], JUNE_15, noTags, 'child')).toEqual([]);
    });
  });

  describe('events crossing midnight', () => {
    // Pacific 16:00 -> 20:00 is local 23:00 on the 15th -> 03:00 on the 16th.
    const crossing = ev('2026-06-15 16:00:00', '2026-06-15 20:00:00');

    it('is clipped to the end of the starting day', () => {
      const [e] = positionEventsForDay([crossing], JUNE_15, noTags, 'child');
      expect(e.top_position).toBe(23 * 60);
      // Clipped to 23:59:59, so the minute count stops at 23:59.
      expect(e.height).toBe(59);
      expect(e.duration_minutes).toBe(59);
    });

    it('is clipped to the start of the following day', () => {
      const [e] = positionEventsForDay([crossing], JUNE_16, noTags, 'child');
      expect(e.top_position).toBe(0);
      expect(e.height).toBe(3 * 60);
    });

    it('labels the unclipped range on both days', () => {
      for (const day of [JUNE_15, JUNE_16]) {
        const [e] = positionEventsForDay([crossing], day, noTags, 'child');
        expect(e.start_time).toBe('11:00 PM');
        expect(e.end_time).toBe('03:00 AM');
        expect(e.time_range).toBe('Jun 15 11:00 PM - Jun 16 03:00 AM');
      }
    });

    // The day ends at 23:59:59, so an event ending at midnight is clipped too.
    it('stops an event ending exactly at midnight one minute short', () => {
      // Pacific 16:00-17:00 is local 23:00-00:00.
      const [e] = positionEventsForDay([ev('2026-06-15 16:00:00', '2026-06-15 17:00:00')], JUNE_15, noTags, 'child');
      expect(e.height).toBe(59);
    });

    it('spans the whole day for an event covering it end to end', () => {
      const [e] = positionEventsForDay([ev('2026-06-14 12:00:00', '2026-06-16 12:00:00')], JUNE_15, noTags, 'child');
      expect(e.top_position).toBe(0);
      expect(e.height).toBe(24 * 60 - 1);
    });
  });

  describe('tag colour', () => {
    const tags: Tags = [
      { id: 1, name: 'work', color: '#ff0000', parentId: null },
      { id: 2, name: 'blank', color: '', parentId: null },
    ];
    const colorOf = (tag?: string | null) =>
      positionEventsForDay([ev('2026-06-15 09:00:00', '2026-06-15 10:00:00', { tag })], JUNE_15, tags, 'child')[0].tag_color;

    it('uses the colour of the matching tag', () => {
      expect(colorOf('work')).toBe('#ff0000');
    });

    it('falls back to UNTAGGED_COLOR for unknown, null and missing tags', () => {
      expect(colorOf('nope')).toBe(UNTAGGED_COLOR);
      expect(colorOf(null)).toBe(UNTAGGED_COLOR);
      expect(colorOf(undefined)).toBe(UNTAGGED_COLOR);
    });

    it('falls back to UNTAGGED_COLOR for a tag with an empty colour', () => {
      expect(colorOf('blank')).toBe(UNTAGGED_COLOR);
    });
  });

  it('assigns overlap columns to overlapping events', () => {
    const result = positionEventsForDay(
      [
        ev('2026-06-15 09:30:00', '2026-06-15 10:30:00', { title: 'B' }),
        ev('2026-06-15 09:00:00', '2026-06-15 10:00:00', { title: 'A' }),
        ev('2026-06-15 11:00:00', '2026-06-15 12:00:00', { title: 'C' }),
      ],
      JUNE_15,
      noTags,
      'child'
    );
    expect(result.map((e) => [e.title, e.overlap_column, e.overlap_total])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
      ['C', 0, 1],
    ]);
  });
});

describe('contrastTextClass', () => {
  it('uses white text on dark colours', () => {
    expect(contrastTextClass('#000000')).toBe('text-white');
    expect(contrastTextClass('#1e3a8a')).toBe('text-white');
    expect(contrastTextClass('#6b7280')).toBe('text-white');
  });

  it('uses black text on light colours', () => {
    expect(contrastTextClass('#ffffff')).toBe('text-black');
    expect(contrastTextClass('#fde68a')).toBe('text-black');
    expect(contrastTextClass('#ffff00')).toBe('text-black');
  });

  it('accepts a hex without the leading #', () => {
    expect(contrastTextClass('ffffff')).toBe('text-black');
    expect(contrastTextClass('000000')).toBe('text-white');
  });

  it('falls back to white for anything that is not 6 hex digits', () => {
    expect(contrastTextClass('#fff')).toBe('text-white');
    expect(contrastTextClass('#ffffffff')).toBe('text-white');
    expect(contrastTextClass('')).toBe('text-white');
  });
});

describe('hourLabel', () => {
  it.each([
    [0, '12 AM'],
    [1, '1 AM'],
    [11, '11 AM'],
    [12, '12 PM'],
    [13, '1 PM'],
    [23, '11 PM'],
  ])('hourLabel(%i) is %s', (hour, label) => {
    expect(hourLabel(hour)).toBe(label);
  });
});
