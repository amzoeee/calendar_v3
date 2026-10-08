// Whether approving a log import folds it into same-name neighbours. Kept in a
// cookie so the choice sticks, and so the calendar can preview the result.
export const MERGE_PENDING_COOKIE = 'mergePending';

interface Mergeable {
  id: number;
  startDatetime: string;
  endDatetime: string;
  title: string;
  isPending: number;
  recurrenceId?: string | null;
  rrule?: string | null;
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Works out which events merge: the first pending event into the approved one
 * that ends right where it starts, and each pending event into the one just
 * before it, when the names match. Only exactly back-to-back events merge — a
 * gap means the activity really did stop.
 *
 * Returns the new end of every event that grows, and the ids that get folded
 * into them.
 */
export function planPendingMerge(events: Mergeable[]): { newEnds: Map<number, string>; absorbed: Set<number> } {
  const newEnds = new Map<number, string>();
  const absorbed = new Set<number>();

  const pending = events
    .filter((ev) => ev.isPending === 1)
    .sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
  if (pending.length === 0) return { newEnds, absorbed };

  const previous = events.find(
    (ev) =>
      ev.isPending === 0 &&
      !ev.recurrenceId &&
      !ev.rrule &&
      ev.endDatetime === pending[0].startDatetime &&
      sameTitle(ev.title, pending[0].title),
  );

  let run: { id: number; endDatetime: string; title: string } | null = previous ?? null;
  for (const ev of pending) {
    if (run && run.endDatetime === ev.startDatetime && sameTitle(run.title, ev.title)) {
      run = { ...run, endDatetime: ev.endDatetime };
      newEnds.set(run.id, ev.endDatetime);
      absorbed.add(ev.id);
    } else {
      run = ev;
    }
  }

  return { newEnds, absorbed };
}

/**
 * The calendar as it will look once approved with merging on. An approved
 * event that grows is shown as pending, since approving is what changes it.
 */
export function previewPendingMerge<T extends Mergeable>(events: T[]): T[] {
  const { newEnds, absorbed } = planPendingMerge(events);
  if (absorbed.size === 0) return events;

  return events
    .filter((ev) => !absorbed.has(ev.id))
    .map((ev) => {
      const end = newEnds.get(ev.id);
      return end ? { ...ev, endDatetime: end, isPending: 1 } : ev;
    });
}
