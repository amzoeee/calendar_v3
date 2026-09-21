// Pure helpers for shaping what the bot says back.

/**
 * Warns when a scan stopped because it ran out of lookback rather than because
 * it found a boundary — what it took may be only part of the log.
 */
function capWarning(markerFound, hitCap, messagesScanned) {
  if (markerFound || !hitCap) return '';
  return (
    `\n\n:warning: Stopped at the ${messagesScanned}-message lookback limit without finding a ` +
    '`---` marker, so there may be more above. Post a marker where the log starts, or raise ' +
    '`FETCH_MAX_MESSAGES`.'
  );
}



/**
 * Splits lines into groups that each fit inside `budget` characters. Discord
 * rejects a message over 2000 and a long day's log can pass that; splitting on
 * line boundaries keeps every block copy-pasteable.
 *
 * A single line longer than the budget gets its own group rather than being
 * cut in half — Discord will reject it, which is a better failure than handing
 * someone a silently truncated log line.
 */
function chunkLines(lines, budget) {
  const chunks = [];
  let current = [];
  let size = 0;

  for (const line of lines) {
    if (current.length > 0 && size + line.length + 1 > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

module.exports = { capWarning, chunkLines };
