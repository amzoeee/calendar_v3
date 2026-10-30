import { type TaskRow } from '@/lib/tasks';
import { pacificDbStringToDate } from '@/lib/timezone';

// Still open and already reminded.
export function reminderFired(r: TaskRow): boolean {
  return (
    !r.completedAt &&
    r.remindAt != null &&
    pacificDbStringToDate(r.remindAt).getTime() <= Date.now()
  );
}

// ASAP tasks can't carry a reminder but always count.
export function hasActiveReminder(r: TaskRow): boolean {
  return reminderFired(r) || (!r.completedAt && r.dueAsap === 1);
}
