import { db } from '../db';
import { discordStages } from '../db/schema';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

// How long an unclaimed row survives. Long enough to outlast the bot being
// down for a while, short enough that a channel the bot can no longer post in
// stops being retried forever.
const STAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingMarker {
  id: number;
  discordChannelId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function sweepStaleStages(): Promise<void> {
  const cutoff = new Date(Date.now() - STAGE_TTL_MS).toISOString();
  await db.delete(discordStages).where(lt(discordStages.createdAt, cutoff));
}

/** Remembers that a batch was staged from `channelId`, awaiting approval. */
export async function recordStage(userId: number, channelId: string): Promise<void> {
  await sweepStaleStages();
  await db.insert(discordStages).values({ userId, discordChannelId: channelId });
}

/**
 * Marks a user's outstanding batches approved, which is what releases the
 * marker for the bot to post. Called when the user approves their pending
 * events, whatever staged them — a batch from the paste form simply has no row
 * here and so releases nothing.
 */
export async function markStagesApproved(userId: number): Promise<void> {
  await db
    .update(discordStages)
    .set({ approvedAt: nowIso() })
    .where(and(eq(discordStages.userId, userId), isNull(discordStages.approvedAt)));
}

/** Drops a user's outstanding batches: a discarded log gets no marker. */
export async function dropUnapprovedStages(userId: number): Promise<void> {
  await db
    .delete(discordStages)
    .where(and(eq(discordStages.userId, userId), isNull(discordStages.approvedAt)));
}

/** Markers the bot still owes a channel. */
export async function listApprovedStages(): Promise<PendingMarker[]> {
  await sweepStaleStages();
  return db
    .select({ id: discordStages.id, discordChannelId: discordStages.discordChannelId })
    .from(discordStages)
    .where(isNotNull(discordStages.approvedAt));
}

/** Called once the bot has actually posted them. */
export async function acknowledgeStages(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(discordStages).where(inArray(discordStages.id, ids));
}
