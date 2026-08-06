// Runs pending Drizzle migrations against the mounted SQLite volume, then
// starts `next start` in the foreground so container signals reach it.
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

const dbPath = process.env.DATABASE_PATH || 'calendar.db';
const sqlite = new Database(dbPath);
migrate(drizzle(sqlite), { migrationsFolder: path.join(__dirname, 'drizzle') });
sqlite.close();

const next = spawn(path.join(__dirname, 'node_modules', '.bin', 'next'), ['start'], {
  stdio: 'inherit',
  env: process.env,
});

next.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => next.kill('SIGTERM'));
process.on('SIGINT', () => next.kill('SIGINT'));
