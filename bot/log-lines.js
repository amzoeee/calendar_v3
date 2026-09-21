// The marker that separates "already imported" from "new". A message that is
// nothing but three or more dashes, em-dashes or box-drawing dashes.
const MARKER = /^\s*[-—─]{3,}\s*$/;

// A log line: a shorthand time, an optional am/pm, then the activity.
// Deliberately the same shape the calendar's own parser accepts, so the bot
// never sends a line the app will silently drop.
const LOG_LINE = /^(\d{1,4})\s*(am|pm)?\s+(.+)$/i;

function isMarker(line) {
  return MARKER.test(line);
}

/**
 * Whether `timeStr` is a time the calendar can read: 9, 930, 0930, 1430.
 * Mirrors parseShorthandTime in src/lib/discord-log.ts.
 */
function isValidShorthandTime(timeStr) {
  let hour;
  let minute;

  if (timeStr.length <= 2) {
    hour = parseInt(timeStr, 10);
    minute = 0;
  } else if (timeStr.length === 3) {
    hour = parseInt(timeStr[0], 10);
    minute = parseInt(timeStr.slice(1), 10);
  } else if (timeStr.length === 4) {
    hour = parseInt(timeStr.slice(0, 2), 10);
    minute = parseInt(timeStr.slice(2), 10);
  } else {
    return false;
  }

  return !Number.isNaN(hour) && !Number.isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isLogLine(line) {
  const match = line.trim().match(LOG_LINE);
  return match !== null && isValidShorthandTime(match[1]);
}

/**
 * Walks a channel's messages newest-first and pulls out the log lines written
 * since the last marker.
 *
 * `messages` arrives newest-first, each `{ content, authorId, createdAt }`.
 * Only `authorId === userId` contributes lines — a log channel is usually
 * shared — but a marker from *anyone* (including the bot's own) ends the scan,
 * which is what makes the bot's own marker work as a watermark.
 *
 * Returns the lines chronologically, plus whether a marker was actually found:
 * without one the caller knows it hit the end of its search rather than a
 * real boundary.
 */
function collectLogLines(messages, userId) {
  const lines = [];
  let markerFound = false;
  let oldestAt = null;

  outer: for (const message of messages) {
    const messageLines = message.content.split(/\r?\n/).reverse();

    for (const raw of messageLines) {
      if (isMarker(raw)) {
        markerFound = true;
        break outer;
      }
      if (message.authorId !== userId) continue;
      if (isLogLine(raw)) {
        lines.push(raw.trim());
        oldestAt = message.createdAt;
      }
    }
  }

  return { lines: lines.reverse(), markerFound, oldestAt };
}

module.exports = { collectLogLines, isLogLine, isMarker, isValidShorthandTime };
