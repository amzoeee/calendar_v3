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

// Creating a file is the only check that proves the directory is usable.
// access(2) consults the permission bits alone, which can say "writable" while
// the write is still refused — on a Docker Desktop bind mount the host carries
// out the write as the desktop user rather than as the container's uid, so the
// bits visible inside the container describe the wrong user entirely.
function writeProbeError(dir: string): string | null {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  try {
    fs.unlinkSync(probe);
  } catch {
    // The write succeeded, which is what we were testing for.
  }
  return null;
}

// Backups only run in the deployment: a production build *and* a BACKUP_DIR
// that exists and can actually be written to (docker-compose.yml sets it).
// `npm run dev` and a bare local `npm start` both fall through to a reason.
// Returning the reason rather than a bare null keeps the startup log specific —
// "disabled" on its own can't be told apart from a misconfigured mount.
export type BackupDirResult = { dir: string } | { dir: null; reason: string };

export function resolveBackupDir(): BackupDirResult {
  if (process.env.NODE_ENV !== 'production') {
    return { dir: null, reason: 'not a production build' };
  }

  const dir = process.env.BACKUP_DIR?.trim();
  if (!dir) {
    return {
      dir: null,
      reason: 'BACKUP_DIR is not set — docker-compose.yml sets it in the deployment, so ' +
        'a container started before it was added needs `docker compose up -d app` to pick it up',
    };
  }

  if (!fs.existsSync(dir)) {
    return { dir: null, reason: `BACKUP_DIR "${dir}" does not exist` };
  }

  const probeError = writeProbeError(dir);
  if (probeError) {
    return {
      dir: null,
      reason: `cannot write to BACKUP_DIR "${dir}" (${probeError}) — the host directory has to be ` +
        "writable by whichever user the container's writes land as: your own user under Docker " +
        'Desktop, or uid 1001 on a plain Linux host',
    };
  }

  return { dir };
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

export async function runBackupIfDue(dir: string, now = new Date()): Promise<void> {
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

  const resolved = resolveBackupDir();
  if (resolved.dir === null) {
    console.log(`[backup] disabled — ${resolved.reason}`);
    return;
  }

  const { dir } = resolved;
  console.log(`[backup] enabled — every ~2 days to ${dir}, keeping every snapshot`);
  sweepPartials(dir);

  // Delayed so a cold start serves requests before copying the database.
  setTimeout(() => void runBackupIfDue(dir), STARTUP_DELAY_MS).unref();
  setInterval(() => void runBackupIfDue(dir), HEARTBEAT_MS).unref();
}
