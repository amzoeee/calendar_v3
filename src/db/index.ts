import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

let dbInstance: ReturnType<typeof drizzle<typeof schema>>;

if (process.env.NODE_ENV === 'production') {
  const sqlite = new Database('calendar.db');
  dbInstance = drizzle(sqlite, { schema });
} else {
  if (!globalForDb.db) {
    const sqlite = new Database('calendar.db');
    globalForDb.db = drizzle(sqlite, { schema });
  }
  dbInstance = globalForDb.db;
}

export const db = dbInstance;
