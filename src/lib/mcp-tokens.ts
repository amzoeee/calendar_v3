import crypto from 'crypto';
import { db } from '@/db';
import { mcpTokens, users } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';

const TOKEN_PREFIX = 'calmcp_';
// Shown in Settings so tokens can be told apart; reveals nothing guessable.
const DISPLAY_CHARS = TOKEN_PREFIX.length + 4;

export interface McpTokenView {
  id: number;
  name: string;
  tokenPrefix: string;
  timeZone: string;
  lastUsedAt: string | null;
  createdAt: string | null;
}

export interface McpCaller {
  tokenId: number;
  userId: number;
  username: string;
  timeZone: string;
}

// Tokens are 256 random bits, so a plain hash is enough; no salt or slow KDF.
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Returns the plaintext token; it is never stored, so this is the only time it exists. */
export async function createMcpToken(userId: number, name: string, timeZone: string): Promise<string> {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  await db.insert(mcpTokens).values({
    userId,
    name,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, DISPLAY_CHARS),
    timeZone,
  });
  return token;
}

export async function listMcpTokens(userId: number): Promise<McpTokenView[]> {
  return db
    .select({
      id: mcpTokens.id,
      name: mcpTokens.name,
      tokenPrefix: mcpTokens.tokenPrefix,
      timeZone: mcpTokens.timeZone,
      lastUsedAt: mcpTokens.lastUsedAt,
      createdAt: mcpTokens.createdAt,
    })
    .from(mcpTokens)
    .where(eq(mcpTokens.userId, userId))
    .orderBy(desc(mcpTokens.id));
}

export async function revokeMcpToken(userId: number, id: number): Promise<void> {
  await db.delete(mcpTokens).where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)));
}

/** Returns false when the token isn't the user's. */
export async function setMcpTokenTimeZone(userId: number, id: number, timeZone: string): Promise<boolean> {
  const result = await db
    .update(mcpTokens)
    .set({ timeZone })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)));
  return result.changes > 0;
}

/** Resolves an `Authorization` header to the account it speaks for, recording the use. */
export async function authenticateMcpRequest(authorizationHeader: string | null): Promise<McpCaller | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const [row] = await db
    .select({
      tokenId: mcpTokens.id,
      userId: mcpTokens.userId,
      username: users.username,
      timeZone: mcpTokens.timeZone,
    })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(eq(mcpTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;

  await db
    .update(mcpTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(mcpTokens.id, row.tokenId));
  return row;
}
