// Every knob the bot has, read once at startup so a missing one fails loudly
// here rather than halfway through someone's /fetch.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

// The per-person channel features only run in one server. Setting its ID
// turns them on, and then the IDs they can't work without become required.
function serverChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return null;

  return {
    guildId,
    activeRoleId: required('DISCORD_ACTIVE_ROLE_ID'),
    activeCategoryId: required('DISCORD_ACTIVE_CATEGORY_ID'),
    archiveCategoryId: required('DISCORD_ARCHIVE_CATEGORY_ID'),
    // Without one, admin means the Administrator permission.
    adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || null,
    logChannelId: process.env.DISCORD_LOG_CHANNEL_ID || null,
    inactiveAfterDays: Number(process.env.INACTIVE_AFTER_DAYS || 7),
    checkMinutes: Number(process.env.ACTIVITY_CHECK_MINUTES || 60),
    dataDir: process.env.BOT_DATA_DIR || `${__dirname}/data`,
  };
}

const apiUrl =(process.env.CALENDAR_API_URL || 'http://app:4000').replace(/\/+$/, '');

module.exports = {
  token: required('DISCORD_BOT_TOKEN'),
  botSecret: required('DISCORD_BOT_SECRET'),

  // Where the bot reaches the calendar. Inside compose that's the app service
  // over the internal network; the public URL is only used for links it shows
  // people, which must be reachable from their browser.
  apiUrl,
  publicUrl: (process.env.CALENDAR_PUBLIC_URL || apiUrl).replace(/\/+$/, ''),

  // How far /fetch will expand its search before giving up on finding a
  // marker. Discord's history endpoint pages 100 messages at a time.
  maxMessages: Number(process.env.FETCH_MAX_MESSAGES || 500),

  // Whether the bot drops a `---` in the channel once a staged batch is
  // approved, so the next /fetch stops there instead of re-reading what it
  // already took.
  postMarker: process.env.FETCH_POST_MARKER !== 'false',

  // How often the bot asks the app whether anything it staged has been
  // approved since. Approval happens in a browser, so there is nothing to
  // push the news back here.
  markerPollSeconds: Number(process.env.MARKER_POLL_SECONDS || 15),

  serverChannels: serverChannels(),
};
