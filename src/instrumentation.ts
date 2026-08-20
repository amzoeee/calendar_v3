// Runs once per server process on startup. The dynamic import keeps
// better-sqlite3 and node:fs out of any non-Node bundle (middleware runs on
// the edge runtime, where neither exists).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startBackupScheduler } = await import('@/lib/backup');
  startBackupScheduler();
}
