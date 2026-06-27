import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const SECRET_KEY = process.env.SECRET_KEY || 'default-dev-secret-key-at-least-32-chars-long';
const COOKIE_NAME = 'calendar_session';

// Helper to sign a session string
function signSession(data: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('pbkdf2:sha256:')) {
    try {
      const parts = hash.split('$');
      if (parts.length !== 3) return false;
      const prefix = parts[0];
      const salt = parts[1];
      const storedHashHex = parts[2];
      const iterations = parseInt(prefix.split(':')[2], 10);

      const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
      const derivedHex = derivedKey.toString('hex');

      return crypto.timingSafeEqual(
        Buffer.from(derivedHex, 'hex'),
        Buffer.from(storedHashHex, 'hex')
      );
    } catch {
      return false;
    }
  }
  return bcrypt.compare(password, hash);
}

export interface SessionData {
  userId: number;
  username: string;
}

export async function createSession(userId: number, username: string): Promise<void> {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const sessionString = `${userId}:${username}:${expires}`;
  const signature = signSession(sessionString);
  const cookieValue = `${sessionString}.${signature}`;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(expires),
    path: '/',
  });
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie) return null;

  try {
    const [sessionString, signature] = cookie.value.split('.');
    if (!sessionString || !signature) return null;

    const expectedSignature = signSession(sessionString);
    if (signature !== expectedSignature) return null;

    const [userIdStr, username, expiresStr] = sessionString.split(':');
    const expires = parseInt(expiresStr, 10);

    if (isNaN(expires) || expires < Date.now()) {
      return null;
    }

    return {
      userId: parseInt(userIdStr, 10),
      username,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}
