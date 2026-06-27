export interface PositionedEvent {
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
  // Position properties computed for the UI
  top_position?: number;
  height?: number;
  duration_minutes?: number;
  start_time?: string;
  end_time?: string;
  start_datetime_local?: string;
  end_datetime_local?: string;
  tag_color?: string;
  multi_day?: boolean;
  continues_before?: boolean;
  continues_after?: boolean;
  overlap_column?: number;
  overlap_total?: number;
}

function eventsOverlap(e1: PositionedEvent, e2: PositionedEvent): boolean {
  const start1 = new Date(e1.startDatetime.replace(' ', 'T')).getTime();
  const end1 = new Date(e1.endDatetime.replace(' ', 'T')).getTime();
  const start2 = new Date(e2.startDatetime.replace(' ', 'T')).getTime();
  const end2 = new Date(e2.endDatetime.replace(' ', 'T')).getTime();

  return start1 < end2 && start2 < end1;
}

export function calculateOverlapColumns<T extends PositionedEvent>(events: T[]): T[] {
  if (!events || events.length === 0) {
    return [];
  }

  // Sort events by start datetime
  const sortedEvents = [...events].sort((a, b) => 
    a.startDatetime.localeCompare(b.startDatetime)
  );

  // Find overlapping groups
  const groups: T[][] = [];
  for (const event of sortedEvents) {
    const overlappingGroupIndices: number[] = [];
    
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].some(e => eventsOverlap(event, e))) {
        overlappingGroupIndices.push(i);
      }
    }

    if (overlappingGroupIndices.length === 0) {
      // No overlap, create new group
      groups.push([event]);
    } else {
      // Merge all overlapping groups and add this event
      const mergedGroup: T[] = [event];
      // Pop from end to front to keep indices valid
      for (const i of [...overlappingGroupIndices].reverse()) {
        mergedGroup.push(...groups.splice(i, 1)[0]);
      }
      groups.push(mergedGroup);
    }
  }

  // Assign columns within each group
  for (const group of groups) {
    // Sort by start datetime within the group
    group.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));

    // columns[colIndex] = Array of events assigned to that column
    const columns: T[][] = [];
    
    for (const event of group) {
      const eventStart = new Date(event.startDatetime.replace(' ', 'T')).getTime();
      
      let col = 0;
      while (true) {
        let isFree = true;
        if (col < columns.length) {
          for (const existingEvent of columns[col]) {
            const existingEnd = new Date(existingEvent.endDatetime.replace(' ', 'T')).getTime();
            if (existingEnd > eventStart) {
              isFree = false;
              break;
            }
          }
        }

        if (isFree) {
          if (col >= columns.length) {
            columns.push([]);
          }
          columns[col].push(event);
          event.overlap_column = col;
          break;
        }
        col++;
      }
    }

    // Set the overlap_total for all events in this group to the total column count
    const totalCols = columns.length;
    for (const event of group) {
      event.overlap_total = totalCols;
    }
  }

  return sortedEvents;
}
