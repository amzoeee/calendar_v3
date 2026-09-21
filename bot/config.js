// Every knob the bot has, read once at startup so a missing one fails loudly
// here rather than halfway through someone's /fetch.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

const apiUrl = (process.env.CALENDAR_API_URL || 'http://app:4000').replace(/\/+$/, '');

module.exports = {
  token: required('DISCORD_BOT_TOKEN'),
  botSecret: required('DISCORD_BOT_SECRET'),

  // Where the bot reaches the calendar. Inside compose that's the app service
  // over the internal network; the public URL is only used for links it shows
  // people, which must be reachable from their browser.
  apiUrl,
  publicUrl: (process.env.CALENDAR_PUBLIC_URL || apiUrl).replace(/\/+$/, ''),

  // The calendar stores wall-clock times in one zone; logs scraped out of
  // Discord are interpreted in this one.
  timeZone: process.env.CALENDAR_TIMEZONE || 'America/Los_Angeles',

  // How far /fetch will expand its search before giving up on finding a
  // marker. Discord's history endpoint pages 100 messages at a time.
  maxMessages: Number(process.env.FETCH_MAX_MESSAGES || 500),

  // Whether the bot drops a `---` in the channel after staging, so the next
  // /fetch stops there instead of re-reading what it already took.
  postMarker: process.env.FETCH_POST_MARKER !== 'false',
};
