import { notFound } from 'next/navigation';
import { getSession, type SessionData } from '@/lib/auth';

// Comma-separated usernames, e.g. ADMIN_USERNAMES=zoe. Unset means no admins.
function adminUsernames(): Set<string> {
  return new Set(
    (process.env.ADMIN_USERNAMES ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(username: string): boolean {
  return adminUsernames().has(username.toLowerCase());
}

// 404s rather than redirecting, so non-admins can't tell the page exists.
export async function requireAdmin(): Promise<SessionData> {
  const session = await getSession();
  if (!session || !isAdmin(session.username)) notFound();
  return session;
}
