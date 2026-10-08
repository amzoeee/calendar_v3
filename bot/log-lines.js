// The marker that separates "already imported" from "new": a line that opens
// with three or more dashes, em-dashes or box-drawing dashes. Any number of
// them counts, and anything after them is allowed — a Discord copy-paste
// separator like `--- Yesterday at 9:00 PM ---` is still a marker. Log lines
// open with a digit, so nothing legitimate is swallowed.
const MARKER = /^\s*[-—─]{3,}/;

// A log line: a shorthand or colon time, an optional am/pm, then the activity.
// Deliberately the same shape the calendar's own parser accepts, so the bot
// never sends a line the app will silently drop.
const LOG_LINE = /^(\d{1,2}:\d{2}|\d{1,4})\s*(am|pm)?\s+(.+)$/i;

function isMarker(line) {
  return MARKER.test(line);
}

/**
 * Whether `timeStr` is a time the calendar can read: 9, 930, 0930, 1430, 10:30.
 * Mirrors parseShorthandTime in src/lib/discord-log.ts.
 */
function isValidShorthandTime(timeStr) {
  timeStr = timeStr.replace(':', '');

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
 * shared — unless `userId` is null, which takes everyone's. A marker from
 * *anyone* (including the bot's own) ends the scan, which is what makes the
 * bot's own marker work as a watermark.
 *
 * Returns the lines chronologically, plus whether a marker was actually found:
 * without one the caller knows it hit the end of its search rather than a
 * real boundary. `latest` is the newest line and the message it came from.
 */
function collectLogLines(messages, userId) {
  const lines = [];
  let markerFound = false;
  let oldestAt = null;
  let latest = null;

  outer: for (const message of messages) {
    const messageLines = message.content.split(/\r?\n/).reverse();

    for (const raw of messageLines) {
      if (isMarker(raw)) {
        markerFound = true;
        break outer;
      }
      if (userId !== null && message.authorId !== userId) continue;
      if (isLogLine(raw)) {
        lines.push(raw.trim());
        oldestAt = message.createdAt;
        latest ??= { line: raw.trim(), message };
      }
    }
  }

  return { lines: lines.reverse(), markerFound, oldestAt, latest };
}

function activityOf(line) {
  const match = line.trim().match(LOG_LINE);
  return match ? match[3].trim().toLowerCase() : null;
}

/**
 * Collapses runs of the same activity into one line. A line's time is when
 * that activity *ended*, so the last of the run is kept: `1400 study` then
 * `1500 study` becomes a single study event ending at 1500.
 */
function mergeRepeats(lines) {
  return lines.filter((line, i) => i === lines.length - 1 || activityOf(line) !== activityOf(lines[i + 1]));
}

/**
 * Minutes past midnight a log line's time could mean. One value when it's
 * unambiguous; both readings for a bare 1-12 like `630`.
 */
function possibleMinutes(line) {
  const match = line.trim().match(LOG_LINE);
  if (!match || !isValidShorthandTime(match[1])) return [];

  const digits = match[1].replace(':', '');
  const [hourStr, minuteStr] = match[1].includes(':')
    ? match[1].split(':')
    : digits.length <= 2
      ? [digits, '0']
      : [digits.slice(0, digits.length - 2), digits.slice(-2)];
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const ampm = match[2]?.toLowerCase();
  if (ampm) return [((hour % 12) + (ampm === 'pm' ? 12 : 0)) * 60 + minute];
  if (hour === 0 || hour > 12) return [hour * 60 + minute];
  return [(hour % 12) * 60 + minute, ((hour % 12) + 12) * 60 + minute];
}

/** Whether two lines could carry the same time of day. */
function sameTime(a, b) {
  const minutesA = possibleMinutes(a);
  return possibleMinutes(b).some((m) => minutesA.includes(m));
}

module.exports = { activityOf, collectLogLines, isLogLine, isMarker, isValidShorthandTime, mergeRepeats, sameTime };
