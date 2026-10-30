import { calculateOverlapColumns, type PositionedEvent } from '@/lib/overlap';
import {
  formatClockTime,
  formatDateInputValue,
  formatEventTimeRange,
  formatTimeInputValue,
  pacificDbStringToDate,
} from '@/lib/timezone';
import { eventTagColor, type SubtagDisplay } from '@/lib/tags';

export const UNTAGGED_COLOR = '#6b7280';

// The DB row shape both calendar views receive from the server.
export interface EventRowLike {
  id: number;
  startDatetime: string;
  endDatetime: string;
  title: string;
  description?: string | null;
  tag?: string | null;
  userId: number;
  recurrenceId?: string | null;
  rrule?: string | null;
  originalStart?: string | null;
  isPending: number;
}

/**
 * The events that touch `day` (local midnight), clipped to it and laid out in
 * overlap columns. Positions are in minutes, so zooming doesn't invalidate them.
 */
export function positionEventsForDay(
  events: EventRowLike[],
  day: Date,
  tags: Parameters<typeof eventTagColor>[0],
  subtagDisplay: SubtagDisplay
): PositionedEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59).getTime();
  const processed: PositionedEvent[] = [];

  for (const ev of events) {
    const startDt = pacificDbStringToDate(ev.startDatetime);
    const endDt = pacificDbStringToDate(ev.endDatetime);

    const clippedStart = Math.max(startDt.getTime(), dayStart);
    const clippedEnd = Math.min(endDt.getTime(), dayEnd);
    if (clippedStart >= dayEnd || clippedEnd <= dayStart) continue;

    const startMin = new Date(clippedStart).getHours() * 60 + new Date(clippedStart).getMinutes();
    const endMin = new Date(clippedEnd).getHours() * 60 + new Date(clippedEnd).getMinutes();
    const duration = endMin - startMin;

    processed.push({
      id: ev.id,
      startDatetime: ev.startDatetime,
      endDatetime: ev.endDatetime,
      title: ev.title,
      description: ev.description,
      tag: ev.tag,
      userId: ev.userId,
      recurrenceId: ev.recurrenceId,
      rrule: ev.rrule,
      originalStart: ev.originalStart,
      isPending: ev.isPending,
      top_position: startMin,
      height: duration,
      duration_minutes: duration,
      start_time: formatClockTime(startDt),
      end_time: formatClockTime(endDt),
      time_range: formatEventTimeRange(startDt, endDt),
      start_datetime_local: `${formatDateInputValue(startDt)}T${formatTimeInputValue(startDt)}`,
      end_datetime_local: `${formatDateInputValue(endDt)}T${formatTimeInputValue(endDt)}`,
      tag_color: eventTagColor(tags, ev.tag ?? null, subtagDisplay) || UNTAGGED_COLOR,
    });
  }

  return calculateOverlapColumns(processed);
}

/** Black or white text, whichever reads better on `hexColor`. */
export function contrastTextClass(hexColor: string): 'text-black' | 'text-white' {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return 'text-white';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? 'text-black' : 'text-white';
}

/** "12 AM", "1 PM" for an hour of the day. */
export function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}
