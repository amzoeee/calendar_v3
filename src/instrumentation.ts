// Runs once per server process on startup. The dynamic imports keep
// better-sqlite3 and node:fs out of any non-Node bundle (middleware runs on
// the edge runtime, where neither exists).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Before anything can serve a request, since a database with no schema
  // fails every one of them.
  const { applyMigrations } = await import('@/db/migrate');
  applyMigrations();

  const { startBackupScheduler } = await import('@/lib/backup');
  startBackupScheduler();
}
