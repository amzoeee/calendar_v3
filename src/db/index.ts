import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
  sqlite: Database.Database | undefined;
};

let dbInstance: ReturnType<typeof drizzle<typeof schema>>;
let sqliteInstance: Database.Database;

// Overridable so the db file can live on a mounted volume in Docker.
const dbPath = process.env.DATABASE_PATH || 'calendar.db';

if (process.env.NODE_ENV === 'production') {
  sqliteInstance = new Database(dbPath);
  dbInstance = drizzle(sqliteInstance, { schema });
} else {
  if (!globalForDb.db || !globalForDb.sqlite) {
    const sqlite = new Database(dbPath);
    globalForDb.sqlite = sqlite;
    globalForDb.db = drizzle(sqlite, { schema });
  }
  dbInstance = globalForDb.db;
  sqliteInstance = globalForDb.sqlite;
}

export const db = dbInstance;

// The raw handle behind `db`. Drizzle doesn't surface better-sqlite3's online
// backup() API, which the scheduled backups in src/lib/backup.ts rely on to
// snapshot the file safely while the app keeps writing to it.
export const sqlite = sqliteInstance;
