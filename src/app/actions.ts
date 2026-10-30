'use server';

import { db } from '@/db';
import { tags, events, discordStages } from '@/db/schema';
import { eq, and, asc, inArray, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { deleteRecurringSeries, updateRecurringSeries } from '@/lib/recurring';
import { stageLogForUser, recalculatePendingEventsDate, mergePendingIntoNeighbours, discardPendingForUser } from '@/lib/discord-log';
import { browserDatetimeToServerDbString, addHoursToDbString } from '@/lib/timezone';
import { redeemLinkCode, unlinkDiscordAccount } from '@/lib/discord-link';
import { markStagesApproved } from '@/lib/discord-markers';
import { replaceInTitle, retitleKeepingBrackets } from '@/lib/titleParts';
import { track } from '@/lib/usage';

// ==========================================
// Event Actions
// ==========================================

export async function addEventAction(data: {
  title: string;
  description: string;
  tag: string;
  startDatetime: string;
  endDatetime: string;
  timeZone: string;
}) {
  const session = await requireAuth();
  track(session.userId, 'event.create');

  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  // Convert HTML local date+time inputs (entered in the browser's timezone) to
  // DB format (YYYY-MM-DD HH:MM:SS) in the server's timezone (Pacific).
  const startStr = browserDatetimeToServerDbString(data.startDatetime, data.timeZone);
  let endStr = browserDatetimeToServerDbString(data.endDatetime, data.timeZone);

  if (endStr <= startStr) {
    endStr = addHoursToDbString(startStr, 1); // default 1 hour
  }

  await db.insert(events).values({
    startDatetime: startStr,
    endDatetime: endStr,
    title,
    description,
    tag,
    userId: session.userId,
    isPending: 0,
  });

  revalidatePath('/calendar', 'layout');
}

export async function updateEventAction(
  id: number,
  data: {
    title: string;
    description: string;
    tag: string;
    startDatetime: string;
    endDatetime: string;
    timeZone: string;
  }
) {
  const session = await requireAuth();
  track(session.userId, 'event.edit');

  const title = data.title.trim() || '(no name)';
  const description = data.description || '';
  const tag = data.tag || null;

  const startStr = browserDatetimeToServerDbString(data.startDatetime, data.timeZone);
  let endStr = browserDatetimeToServerDbString(data.endDatetime, data.timeZone);

  if (endStr <= startStr) {
    endStr = addHoursToDbString(startStr, 1);
  }

  await db
    .update(events)
    .set({
      title,
      description,
      tag,
      startDatetime: startStr,
      endDatetime: endStr,
    })
    .where(and(eq(events.id, id), eq(events.userId, session.userId)));

  revalidatePath('/calendar', 'layout');
}

export type EventRow = typeof events.$inferSelect;

/** Returns the deleted row, so Undo can put it back. */
export async function deleteEventAction(id: number): Promise<EventRow[]> {
  const session = await requireAuth();
  track(session.userId, 'event.delete');

  const deleted = await db
    .delete(events)
    .where(and(eq(events.id, id), eq(events.userId, session.userId)))
    .returning();

  revalidatePath('/calendar', 'layout');
  return deleted;
}

/** Puts back events removed by a delete, under their original ids. */
export async function reinsertEventsAction(rows: EventRow[]) {
  const session = await requireAuth();
  track(session.userId, 'undo.event');
  if (rows.length === 0) return;

  await db
    .insert(events)
    .values(rows.map((r) => ({ ...r, userId: session.userId })))
    .onConflictDoNothing();

  revalidatePath('/calendar', 'layout');
}

export async function copyEventAction(id: number) {
  const session = await requireAuth();
  track(session.userId, 'event.copy');

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.userId, session.userId)))
    .limit(1);

  if (event) {
    await db.insert(events).values({
      startDatetime: event.startDatetime,
      endDatetime: event.endDatetime,
      title: event.title,
      description: event.description,
      tag: event.tag,
      userId: session.userId,
      isPending: 0,
    });
  }

  revalidatePath('/calendar', 'layout');
}

/** Returns the deleted rows, so Undo can put them back. */
export async function deleteRecurringSeriesAction(recurrenceId: string): Promise<EventRow[]> {
  const session = await requireAuth();
  track(session.userId, 'event.series_delete');
  const deleted = await deleteRecurringSeries(recurrenceId, session.userId);
  revalidatePath('/calendar', 'layout');
  return deleted;
}

export async function updateRecurringSeriesAction(
  recurrenceId: string,
  data: { title: string; description: string; tag: string }
) {
  const session = await requireAuth();
  track(session.userId, 'event.series_edit');
  await updateRecurringSeries(recurrenceId, session.userId, data.title, data.description, data.tag);
  revalidatePath('/calendar', 'layout');
}

export interface BulkEditInput {
  renameIds: number[];
  // Null replaces each whole title; otherwise only this text inside it.
  renameFrom: string | null;
  // Same-name events. Their whole title (bar any [context]) is replaced when
  // `renameFrom` isn't found in it, since parsing can strip text
  // ("SLEEP!! :D yippee").
  exactIds: number[];
  renameMode: 'word' | 'substring';
  renameTo: string | null;
  retagIds: number[];
  // Undefined keeps each event's tag; null clears it.
  tag?: string | null;
}

const BULK_CHUNK = 500;

export interface EventSnapshot {
  id: number;
  title: string;
  tag: string | null;
}

/**
 * Renames and/or retags many events at once, from the lifetime view. Returns
 * the previous title and tag of every event it changed, for Undo.
 */
export async function bulkEditEventsAction(input: BulkEditInput) {
  const session = await requireAuth();
  track(session.userId, 'lifetime.bulk_edit');
  const renameTo = input.renameTo?.trim() || null;
  const retag = input.tag !== undefined;
  let renamed = 0;
  let retagged = 0;
  const previous: EventSnapshot[] = [];

  if (input.tag) {
    const [owned] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, session.userId), eq(tags.name, input.tag)));
    if (!owned) return { error: 'That tag no longer exists.' };
  }

  const renameSet = new Set(renameTo ? input.renameIds : []);
  const exactSet = new Set(input.exactIds);
  const retagSet = new Set(retag ? input.retagIds : []);
  const ids = [...new Set([...renameSet, ...retagSet])];

  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const rows = tx
        .select({ id: events.id, title: events.title, tag: events.tag })
        .from(events)
        .where(
          and(
            eq(events.userId, session.userId),
            eq(events.isPending, 0),
            inArray(events.id, ids.slice(i, i + BULK_CHUNK)),
          ),
        )
        .all();
      for (const row of rows) {
        let title = row.title;
        if (renameTo && renameSet.has(row.id)) {
          title = input.renameFrom
            ? replaceInTitle(row.title, input.renameFrom, renameTo, input.renameMode)
            : renameTo;
          if (title === row.title && exactSet.has(row.id)) title = retitleKeepingBrackets(row.title, renameTo);
        }
        const tag = retag && retagSet.has(row.id) ? (input.tag ?? null) : row.tag;
        if (title === row.title && tag === row.tag) continue;
        tx.update(events).set({ title, tag }).where(eq(events.id, row.id)).run();
        if (title !== row.title) renamed++;
        if (tag !== row.tag) retagged++;
        previous.push(row);
      }
    }
  });

  revalidatePath('/calendar', 'layout');
  revalidatePath('/stats', 'layout');
  return { renamed, retagged, previous };
}

/** Puts back titles and tags captured by bulkEditEventsAction. */
export async function restoreEventsAction(snapshots: EventSnapshot[]) {
  const session = await requireAuth();
  db.transaction((tx) => {
    for (const s of snapshots) {
      tx.update(events)
        .set({ title: s.title, tag: s.tag })
        .where(and(eq(events.id, s.id), eq(events.userId, session.userId)))
        .run();
    }
  });
  revalidatePath('/calendar', 'layout');
  revalidatePath('/stats', 'layout');
}

// ==========================================
// Discord Log Actions
// ==========================================

export async function stageLogAction(text: string, dateOverride?: string | null, browserTimeZone?: string) {
  const session = await requireAuth();
  track(session.userId, 'import.paste_log');
  const result = await stageLogForUser(session.userId, text, dateOverride, browserTimeZone);
  if (result.success) revalidatePath('/calendar', 'layout');
  return result;
}

/** Staged events plus the user's tags, for the import review panel. */
export async function listPendingEventsAction() {
  const session = await requireAuth();
  const [pending, userTags] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        startDatetime: events.startDatetime,
        endDatetime: events.endDatetime,
        tag: events.tag,
      })
      .from(events)
      .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)))
      .orderBy(asc(events.startDatetime)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color, isArchived: tags.isArchived, scope: tags.scope })
      .from(tags)
      .where(eq(tags.userId, session.userId))
      .orderBy(asc(tags.orderIndex)),
  ]);
  return { events: pending, tags: userTags };
}

/** Sets the tag on staged events. Returns their previous values, for Undo. */
export async function retagPendingEventsAction(ids: number[], tag: string | null) {
  const session = await requireAuth();
  if (tag) {
    const [owned] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, session.userId), eq(tags.name, tag)));
    if (!owned) return { error: 'That tag no longer exists.' };
  }

  const previous: EventSnapshot[] = [];
  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const where = and(
        eq(events.userId, session.userId),
        eq(events.isPending, 1),
        inArray(events.id, ids.slice(i, i + BULK_CHUNK)),
      );
      previous.push(
        ...tx.select({ id: events.id, title: events.title, tag: events.tag }).from(events).where(where).all(),
      );
      tx.update(events).set({ tag }).where(where).run();
    }
  });

  revalidatePath('/calendar', 'layout');
  return { previous };
}

export interface ApprovedImport {
  ids: number[];
  absorbed: EventRow[];
  extended: { id: number; endDatetime: string }[];
  stageIds: number[];
}

/** Returns what approving changed, so Undo can put the import back in pending. */
export async function approveAllPendingAction(): Promise<ApprovedImport> {
  const session = await requireAuth();
  track(session.userId, 'import.approve');

  const pending = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));
  const stages = await db
    .select({ id: discordStages.id })
    .from(discordStages)
    .where(and(eq(discordStages.userId, session.userId), isNull(discordStages.approvedAt)));

  const merged = await mergePendingIntoNeighbours(session.userId);

  await db
    .update(events)
    .set({ isPending: 0 })
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));

  // Releases the `---` for the bot to post in whichever channel staged this.
  await markStagesApproved(session.userId);

  revalidatePath('/calendar', 'layout');
  const absorbed = new Set(merged.absorbed);
  return {
    ids: pending.filter((r) => !absorbed.has(r.id)).map((r) => r.id),
    absorbed: pending.filter((r) => absorbed.has(r.id)),
    extended: merged.extended,
    stageIds: stages.map((s) => s.id),
  };
}

/**
 * Reverses approveAllPendingAction. A marker the bot has already posted is
 * gone, so only the events come back for those.
 */
export async function unapproveImportAction(snapshot: ApprovedImport) {
  const session = await requireAuth();
  const mine = (ids: number[]) => and(eq(events.userId, session.userId), inArray(events.id, ids));

  db.transaction((tx) => {
    for (const { id, endDatetime } of snapshot.extended) {
      tx.update(events).set({ endDatetime }).where(mine([id])).run();
    }
    if (snapshot.absorbed.length) {
      tx.insert(events)
        .values(snapshot.absorbed.map((r) => ({ ...r, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
    const ids = [...snapshot.ids, ...snapshot.absorbed.map((r) => r.id)];
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      tx.update(events).set({ isPending: 1 }).where(mine(ids.slice(i, i + BULK_CHUNK))).run();
    }
    if (snapshot.stageIds.length) {
      tx.update(discordStages)
        .set({ approvedAt: null })
        .where(and(eq(discordStages.userId, session.userId), inArray(discordStages.id, snapshot.stageIds)))
        .run();
    }
  });

  revalidatePath('/calendar', 'layout');
}

export interface DiscardedImport {
  rows: EventRow[];
  stages: (typeof discordStages.$inferSelect)[];
}

/** Returns the discarded rows and markers, so Undo can put them back. */
export async function discardAllPendingAction(): Promise<DiscardedImport> {
  const session = await requireAuth();
  track(session.userId, 'import.discard');

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));
  const stages = await db
    .select()
    .from(discordStages)
    .where(and(eq(discordStages.userId, session.userId), isNull(discordStages.approvedAt)));

  await discardPendingForUser(session.userId);

  revalidatePath('/calendar', 'layout');
  return { rows, stages };
}

export async function restoreDiscardedImportAction({ rows, stages }: DiscardedImport) {
  const session = await requireAuth();
  db.transaction((tx) => {
    if (rows.length) {
      tx.insert(events)
        .values(rows.map((r) => ({ ...r, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
    if (stages.length) {
      tx.insert(discordStages)
        .values(stages.map((s) => ({ ...s, userId: session.userId })))
        .onConflictDoNothing()
        .run();
    }
  });
  revalidatePath('/calendar', 'layout');
}

export async function overridePendingDateAction(formData: FormData) {
  const session = await requireAuth();
  track(session.userId, 'import.override_date');
  const newDate = formData.get('newDate') as string;
  if (!newDate) throw new Error('New date is required');

  await recalculatePendingEventsDate(session.userId, newDate);
  revalidatePath('/calendar', 'layout');
}

// ==========================================
// Discord Link Actions
// ==========================================

export async function linkDiscordAction(code: string, timeZone: string | null) {
  const session = await requireAuth();
  track(session.userId, 'discord.link');
  const result = await redeemLinkCode(code, session.userId, timeZone);
  if ('error' in result) return { error: result.error };

  revalidatePath('/settings');
  return { success: true, discordUsername: result.discordUsername };
}

export async function unlinkDiscordAction(discordUserId: string) {
  const session = await requireAuth();
  track(session.userId, 'discord.unlink');
  await unlinkDiscordAccount(session.userId, discordUserId);
  revalidatePath('/settings');
}
