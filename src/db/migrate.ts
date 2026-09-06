import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './index';

// Drizzle's own bookkeeping table, written by `migrate()` — but not by
// `drizzle-kit push`, which applies a schema diff and leaves no history behind.
const HISTORY_TABLE = '__drizzle_migrations';

function tableExists(name: string): boolean {
  return (
    sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(name) !== undefined
  );
}

// Tables SQLite maintains for itself don't count towards "does this database
// have a schema yet", and neither does the history table — a failed
// `drizzle-kit migrate` leaves that one behind empty.
function schemaTableCount(): number {
  const row = sqlite
    .prepare(
      `select count(*) as n from sqlite_master
       where type = 'table' and name not like 'sqlite_%' and name != ?`,
    )
    .get(HISTORY_TABLE) as { n: number };
  return row.n;
}

function appliedMigrationCount(): number {
  if (!tableExists(HISTORY_TABLE)) return 0;
  const row = sqlite.prepare(`select count(*) as n from ${HISTORY_TABLE}`).get() as { n: number };
  return row.n;
}

/**
 * Brings the database up to the current schema on server startup.
 *
 * `new Database(path)` creates the file but nothing in it, so before this a
 * fresh clone got a database with no tables at all: registering or logging in
 * came back with `no such table: users`, and the only thing that ever applied
 * the migrations was the production Docker entrypoint.
 *
 * Whether migrating is safe comes down to how many migrations this database
 * has *applied*, not to whether the history table happens to exist — an
 * interrupted `drizzle-kit migrate` leaves that table behind empty. With no
 * migrations applied and a schema already in place, the database was built by
 * `drizzle-kit push` (what the README's calendar_v2 import documents), and
 * migrating it would start from 0000 and fail on tables that already exist.
 * Those keep working exactly as they do today, so leave them alone and say so.
 */
export function applyMigrations(): void {
  if (appliedMigrationCount() === 0 && schemaTableCount() > 0) {
    console.warn(
      `[db] Skipping migrations: this database already has tables but no applied ` +
        `migrations, so it was built with \`drizzle-kit push\`. Keep using ` +
        `\`npx drizzle-kit push\` to pick up schema changes.`,
    );
    return;
  }

  // Deliberately unguarded: a database the app can't bring up to schema will
  // fail every request anyway, and failing at startup says why exactly once
  // instead of once per request.
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}
