'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { track } from '@/lib/usage';
import { createMcpToken, isValidTimeZone, revokeMcpToken, setMcpTokenTimeZone } from '@/lib/mcp-tokens';

const MAX_NAME_LENGTH = 60;

export async function createMcpTokenAction(name: string, timeZone: string) {
  const session = await requireAuth();
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) return { error: 'Give the token a name.' };
  if (!isValidTimeZone(timeZone)) return { error: `Unknown timezone: ${timeZone}` };

  track(session.userId, 'mcp.token_create');
  const token = await createMcpToken(session.userId, trimmed, timeZone);
  revalidatePath('/settings');
  return { token };
}

export async function revokeMcpTokenAction(id: number) {
  const session = await requireAuth();
  track(session.userId, 'mcp.token_revoke');
  await revokeMcpToken(session.userId, id);
  revalidatePath('/settings');
}

export async function setMcpTokenTimeZoneAction(id: number, timeZone: string) {
  const session = await requireAuth();
  if (!isValidTimeZone(timeZone)) return { error: `Unknown timezone: ${timeZone}` };
  await setMcpTokenTimeZone(session.userId, id, timeZone);
  revalidatePath('/settings');
  return {};
}
