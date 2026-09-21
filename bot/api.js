const config = require('./config');

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.botSecret}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body means the app is broken or something else answered on
    // that port; `ok: false` with no error string is handled by callers.
  }

  return { ok: response.ok, status: response.status, ...payload };
}

const createLinkCode = (discordUserId, discordUsername) =>
  call('/api/discord/link', { method: 'POST', body: { discordUserId, discordUsername } });

const getLinkStatus = (discordUserId) =>
  call(`/api/discord/link?discordUserId=${encodeURIComponent(discordUserId)}`);

const stageLog = (payload) => call('/api/discord/stage', { method: 'POST', body: payload });

module.exports = { createLinkCode, getLinkStatus, stageLog };
