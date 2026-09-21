import crypto from 'crypto';
import { db } from '../db';
import { discordLinks, discordLinkCodes, users } from '../db/schema';
import { and, eq, lt } from 'drizzle-orm';

// Long enough that guessing one inside its lifetime is hopeless, short enough
// to retype from a phone. Ambiguous glyphs (0/O, 1/I) are left out.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60 * 1000;

export interface DiscordLink {
  discordUserId: string;
  discordUsername: string | null;
  userId: number;
  createdAt: string | null;
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function deleteExpiredCodes(): Promise<void> {
  await db.delete(discordLinkCodes).where(lt(discordLinkCodes.expiresAt, nowIso()));
}

/**
 * Compares two secrets without leaking their contents through timing.
 * `timingSafeEqual` throws on a length mismatch, so the lengths are checked
 * first — that much is already public from the header itself.
 */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticates a request from the bot. The bot is a trusted internal client
 * sharing one secret with the app: it speaks for *any* Discord user, so this
 * check is what stops anyone else from claiming to be one.
 */
export function isAuthorizedBotRequest(authorizationHeader: string | null): boolean {
  const expected = process.env.DISCORD_BOT_SECRET;
  if (!expected) return false;
  if (!authorizationHeader?.startsWith('Bearer ')) return false;
  return secretsMatch(authorizationHeader.slice('Bearer '.length), expected);
}

/**
 * Issues a fresh link code for a Discord user, replacing any code they were
 * already holding so the most recent `/link` is always the one that works.
 */
export async function createLinkCode(
  discordUserId: string,
  discordUsername: string | null,
): Promise<{ code: string; expiresAt: string }> {
  await deleteExpiredCodes();
  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.discordUserId, discordUserId));

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  await db.insert(discordLinkCodes).values({ code, discordUserId, discordUsername, expiresAt });

  return { code, expiresAt };
}

/**
 * Redeems a code on behalf of a signed-in calendar user, completing the link.
 * Re-linking an already-linked Discord account just repoints it.
 */
export async function redeemLinkCode(
  code: string,
  userId: number,
): Promise<{ discordUsername: string | null } | { error: string }> {
  await deleteExpiredCodes();

  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rows = await db
    .select()
    .from(discordLinkCodes)
    .where(eq(discordLinkCodes.code, normalized))
    .limit(1);

  const row = rows[0];
  if (!row) return { error: 'That code is not valid, or it has expired. Run /link again in Discord.' };

  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.code, normalized));
  await db.delete(discordLinks).where(eq(discordLinks.discordUserId, row.discordUserId));
  await db.insert(discordLinks).values({
    discordUserId: row.discordUserId,
    discordUsername: row.discordUsername,
    userId,
  });

  return { discordUsername: row.discordUsername };
}

export async function getLinksForUser(userId: number): Promise<DiscordLink[]> {
  const rows = await db
    .select({
      discordUserId: discordLinks.discordUserId,
      discordUsername: discordLinks.discordUsername,
      userId: discordLinks.userId,
      createdAt: discordLinks.createdAt,
    })
    .from(discordLinks)
    .where(eq(discordLinks.userId, userId));
  return rows;
}

export async function unlinkDiscordAccount(userId: number, discordUserId: string): Promise<void> {
  await db
    .delete(discordLinks)
    .where(and(eq(discordLinks.userId, userId), eq(discordLinks.discordUserId, discordUserId)));
}

/** Resolves the calendar account a Discord user has linked, if any. */
export async function resolveLinkedUser(
  discordUserId: string,
): Promise<{ userId: number; username: string } | null> {
  const rows = await db
    .select({ userId: discordLinks.userId, username: users.username })
    .from(discordLinks)
    .innerJoin(users, eq(users.id, discordLinks.userId))
    .where(eq(discordLinks.discordUserId, discordUserId))
    .limit(1);

  return rows[0] ?? null;
}
