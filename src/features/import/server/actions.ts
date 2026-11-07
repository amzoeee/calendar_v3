'use server';

import { db } from '@/db';
import { tags, events, discordStages } from '@/db/schema';
import { eq, and, asc, inArray, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { stageLogForUser, recalculatePendingEventsDate, mergePendingIntoNeighbours, discardPendingForUser } from '@/lib/discord-log';
import { redeemLinkCode, unlinkDiscordAccount } from '@/lib/discord-link';
import { markStagesApproved } from '@/lib/discord-markers';
import { track } from '@/lib/usage';
import type { EventRow, EventSnapshot } from '@/features/events/server/actions';

const BULK_CHUNK = 500;

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
