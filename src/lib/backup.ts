import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { sqlite } from '@/db';

// Issue #40: snapshot the SQLite file to somewhere outside the calendar
// folder, roughly every two days, never deleting an older snapshot, and only
// when actually deployed.

const HOUR_MS = 60 * 60 * 1000;

// The heartbeat is far more frequent than the backup interval — it only asks
// "is one due yet?", so the cadence comes from the due check, not the timer.
const HEARTBEAT_MS = 6 * HOUR_MS;
const STARTUP_DELAY_MS = 30 * 1000;

// Nominally every 2 days. Slack of 2h absorbs the heartbeat's granularity:
// at a strict 48h a backup taken at hour 0 wouldn't be due until the 54h tick,
// and the cadence would drift later on every run.
const DUE_AFTER_MS = 46 * HOUR_MS;

const FILE_PREFIX = 'calendar-';
const FILE_SUFFIX = '.db';
// Written first under this suffix, renamed into place only once verified, so a
// crash mid-copy can't leave a truncated file that looks like a real backup.
const PARTIAL_SUFFIX = '.part';

const NAME_PATTERN = /^calendar-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

const globalForBackup = globalThis as unknown as { backupSchedulerStarted?: boolean };

// Backups only run in the deployment: production build *and* an explicitly
// configured, writable BACKUP_DIR (set from docker-compose.yml). `npm run dev`
// and a bare local `npm start` both fall through to null and do nothing.
export function getBackupDir(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;

  const dir = process.env.BACKUP_DIR?.trim();
  if (!dir) return null;

  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(
      `[backup] BACKUP_DIR "${dir}" is missing or not writable — backups are OFF. ` +
        'Create it on the host and give the container user (uid 1001) write access.',
    );
    return null;
  }

  return dir;
}

// UTC, so the filenames stay sortable and unambiguous across DST.
function timestampName(now: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
}

function parseTimestamp(name: string): number | null {
  const m = NAME_PATTERN.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

// Read from the backup files themselves rather than tracked in memory: the
// container restarts on every watchtower redeploy, and an in-process timer
// would restart its countdown each time and could postpone backups forever.
export function latestBackupAt(dir: string): number | null {
  let newest: number | null = null;
  for (const name of fs.readdirSync(dir)) {
    const at = parseTimestamp(name);
    if (at !== null && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

// Leftovers from a backup that failed partway through. Not backups, so
// clearing them doesn't conflict with "never delete a previous backup".
function sweepPartials(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(PARTIAL_SUFFIX)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch (err) {
      console.error(`[backup] could not remove stale partial ${name}:`, err);
    }
  }
}

function assertIntact(file: string): void {
  const copy = new Database(file, { readonly: true });
  try {
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check returned "${result}"`);
  } finally {
    copy.close();
  }
}

// better-sqlite3's online backup — safe to run while the app is reading and
// writing, so nothing has to be taken offline.
async function writeBackup(dir: string, now: Date): Promise<string> {
  const finalPath = path.join(dir, timestampName(now));
  const partialPath = finalPath + PARTIAL_SUFFIX;

  try {
    await sqlite.backup(partialPath);
    assertIntact(partialPath);
    fs.renameSync(partialPath, finalPath);
  } catch (err) {
    try {
      fs.unlinkSync(partialPath);
    } catch {
      // Nothing to clean up if the copy never got created.
    }
    throw err;
  }

  return finalPath;
}

export async function runBackupIfDue(now = new Date()): Promise<void> {
  const dir = getBackupDir();
  if (!dir) return;

  try {
    const latest = latestBackupAt(dir);
    if (latest !== null && now.getTime() - latest < DUE_AFTER_MS) {
      const ageHours = Math.round((now.getTime() - latest) / HOUR_MS);
      console.log(`[backup] skipped — newest backup is ${ageHours}h old`);
      return;
    }

    const written = await writeBackup(dir, now);
    console.log(`[backup] wrote ${written}`);
  } catch (err) {
    // Never take the app down over a backup; the next heartbeat retries.
    console.error('[backup] failed:', err);
  }
}

export function startBackupScheduler(): void {
  if (globalForBackup.backupSchedulerStarted) return;
  globalForBackup.backupSchedulerStarted = true;

  const dir = getBackupDir();
  if (!dir) {
    console.log('[backup] disabled (needs a production build and a writable BACKUP_DIR)');
    return;
  }

  console.log(`[backup] enabled — every ~2 days to ${dir}, keeping every snapshot`);
  sweepPartials(dir);

  // Delayed so a cold start serves requests before copying the database.
  setTimeout(() => void runBackupIfDue(), STARTUP_DELAY_MS).unref();
  setInterval(() => void runBackupIfDue(), HEARTBEAT_MS).unref();
}
