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


module.exports = { capWarning };
