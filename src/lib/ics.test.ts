import { describe, expect, it } from 'vitest';
import { generateIcs, parseIcsContent } from './ics';

const event = (over = {}) => ({
  id: 1,
  title: 'Standup',
  startDatetime: '2026-10-15 09:00:00',
  endDatetime: '2026-10-15 09:30:00',
  ...over,
});

const lines = (ics: string) => ics.split('\r\n');

describe('generateIcs', () => {
  it('writes UTC times with CRLF line endings', () => {
    const ics = generateIcs([event()], 'Work');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        'PRODID:-//Calendar App//Work//EN',
        'UID:event-1@calendar-app',
        'DTSTART:20261015T160000Z',
        'DTEND:20261015T163000Z',
        'SUMMARY:Standup',
      ])
    );
  });

  it('escapes text', () => {
    const ics = generateIcs([event({ title: 'a, b; c', description: 'line 1\nline 2' })]);
    expect(lines(ics)).toEqual(expect.arrayContaining(['SUMMARY:a\\, b\\; c', 'DESCRIPTION:line 1\\nline 2']));
  });

  it('writes one VEVENT with an RRULE per recurring series', () => {
    const ics = generateIcs([
      event({ id: 1, recurrenceId: 'abc', rrule: 'FREQ=WEEKLY' }),
      event({ id: 2, recurrenceId: 'abc', startDatetime: '2026-10-22 09:00:00', endDatetime: '2026-10-22 09:30:00' }),
    ]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(lines(ics)).toEqual(expect.arrayContaining(['UID:recurring-abc@calendar-app', 'RRULE:FREQ=WEEKLY']));
  });

  it('caps a series at the export range with a UTC UNTIL', () => {
    const ics = generateIcs([event({ recurrenceId: 'abc', rrule: 'FREQ=DAILY;COUNT=99' })], 'x', undefined, '2026-10-20');
    const rrule = lines(ics).find((l) => l.startsWith('RRULE:'));
    expect(rrule).toMatch(/^RRULE:FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/);
  });
});

describe('parseIcsContent', () => {
  it('round-trips what generateIcs writes', () => {
    const parsed = parseIcsContent(generateIcs([event({ title: 'a, b; c', description: 'x\ny' })]));
    expect(parsed).toEqual([
      {
        title: 'a, b; c',
        description: 'x\ny',
        start_datetime: '2026-10-15 09:00:00',
        end_datetime: '2026-10-15 09:30:00',
        rrule: null,
      },
    ]);
  });

  it('honours TZID', () => {
    const [e] = parseIcsContent(
      'BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20260627T123000\r\nDTEND;TZID=America/New_York:20260627T133000\r\nSUMMARY:x\r\nEND:VEVENT'
    );
    expect([e.start_datetime, e.end_datetime]).toEqual(['2026-06-27 09:30:00', '2026-06-27 10:30:00']);
  });

  it('reads floating times in the importing browser’s zone', () => {
    const [e] = parseIcsContent('BEGIN:VEVENT\nDTSTART:20260627T120000\nSUMMARY:x\nEND:VEVENT', 'Europe/London');
    expect([e.start_datetime, e.end_datetime]).toEqual(['2026-06-27 04:00:00', '2026-06-27 05:00:00']);
  });

  it('defaults all-day events to 9am–5pm', () => {
    const [e] = parseIcsContent('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260627\nSUMMARY:x\nEND:VEVENT');
    expect([e.start_datetime, e.end_datetime]).toEqual(['2026-06-27 09:00:00', '2026-06-27 17:00:00']);
  });

  it('unfolds continuation lines', () => {
    const [e] = parseIcsContent('BEGIN:VEVENT\nDTSTART:20260627T120000Z\nSUMMARY:a long\n  title\nEND:VEVENT');
    expect(e.title).toBe('a long title');
  });

  it('keeps RRULEs and skips events without a start', () => {
    const parsed = parseIcsContent(
      'BEGIN:VEVENT\nSUMMARY:no start\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20260627T120000Z\nRRULE:FREQ=DAILY;COUNT=2\nEND:VEVENT'
    );
    expect(parsed.map((e) => [e.title, e.rrule])).toEqual([['(no title)', 'FREQ=DAILY;COUNT=2']]);
  });
});
