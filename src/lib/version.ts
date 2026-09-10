import { execFileSync } from 'node:child_process';

const REPO_URL = 'https://github.com/amzoeee/calendar_v3';

export interface BuildInfo {
  /** Full commit SHA the running build was made from, or null if unknown. */
  commit: string | null;
  /** First 7 characters of `commit`, for display. */
  shortCommit: string | null;
  /** Link to the commit on GitHub, or null if the commit is unknown. */
  commitUrl: string | null;
  /** ISO timestamp of the build, or null if unknown. */
  builtAt: string | null;
}

/**
 * What's actually running. In Docker these come from build args baked in by
 * the publish workflow (see Dockerfile); in local dev there is no such env, so
 * fall back to asking git directly.
 */
export function getBuildInfo(): BuildInfo {
  const commit = process.env.GIT_COMMIT?.trim() || readGitHead();
  const builtAt = process.env.BUILD_TIME?.trim() || null;

  return {
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    commitUrl: commit ? `${REPO_URL}/commit/${commit}` : null,
    builtAt,
  };
}

function readGitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git (production image), or not a checkout — nothing to report.
    return null;
  }
}
