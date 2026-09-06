import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './index';

// Tables SQLite maintains for itself don't count towards "does this database
// have a schema yet".
function userTableCount(): number {
  const row = sqlite
    .prepare(
      "select count(*) as n from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    )
    .get() as { n: number };
  return row.n;
}

// Drizzle's own bookkeeping table, written by `migrate()` and by `drizzle-kit
// migrate` — but not by `drizzle-kit push`, which applies a schema diff and
// leaves no history behind.
function hasMigrationHistory(): boolean {
  return (
    sqlite
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get() !== undefined
  );
}

/**
 * Brings the database up to the current schema on server startup.
 *
 * `new Database(path)` creates the file but nothing in it, so before this a
 * fresh clone got a database with no tables at all: registering or logging in
 * came back with `no such table: users`, and the only thing that ever applied
 * the migrations was the production Docker entrypoint.
 *
 * Three cases, because a database can arrive here three ways:
 *
 * - It has migration history, so `migrate()` knows where it left off and
 *   applies whatever is new.
 * - It's empty — a fresh install — so the migrations build the schema from
 *   nothing and record themselves as applied.
 * - It has tables but no history: `drizzle-kit push` built it, which is what
 *   the README's calendar_v2 import tells you to run. Migrating that would
 *   start from 0000 and fail on tables that already exist, so leave it alone
 *   and say so. Nothing is broken for these — they just keep using push.
 */
export function applyMigrations(): void {
  if (!hasMigrationHistory() && userTableCount() > 0) {
    console.warn(
      '[db] Skipping migrations: this database has tables but no migration history, so ' +
        'it was built with `drizzle-kit push`. Keep using `npx drizzle-kit push` to pick ' +
        'up schema changes.',
    );
    return;
  }

  // Deliberately unguarded: a database the app can't bring up to schema will
  // fail every request anyway, and failing at startup says why exactly once
  // instead of once per request.
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}
