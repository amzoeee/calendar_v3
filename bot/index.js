const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const config = require('./config');
const api = require('./api');
const { collectLogLines } = require('./log-lines');
const { capWarning, chunkLines } = require('./reply');

// en-CA formats as YYYY-MM-DD, the shape the calendar wants.
function dateStrInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('get a code to connect this discord account to your calendar'),
  new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('show which calendar account this is linked to'),
  new SlashCommandBuilder()
    .setName('marker')
    .setDescription('choose whether a --- gets posted here after you approve a staged log')
    .addBooleanOption((option) =>
      option.setName('on').setDescription('true to post the marker, false to leave the channel alone').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('manual-fetch')
    .setDescription('print your log lines since the last --- marker, without staging them')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('day to date the output with (YYYY-MM-DD). defaults to the day you posted it.'),
    ),
  new SlashCommandBuilder()
    .setName('fetch')
    .setDescription('grab your log lines since the last --- marker and stage them in your calendar')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('day the log belongs to (YYYY-MM-DD). defaults to the day you posted it.'),
    ),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('throw away the events you have staged but not approved yet'),
].map((command) => command.toJSON());

const CLEAR_BUTTON_ID = 'clear-staged';

const clearButtonRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLEAR_BUTTON_ID).setLabel('clear staged events').setStyle(ButtonStyle.Danger),
  );

const client = new Client({
  // MessageContent is privileged: enable it on the bot's page in the Discord
  // developer portal, or /fetch reads every message as empty.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});


/**
 * Pulls channel history newest-first, a page at a time, stopping as soon as
 * the scraper has seen a marker — the "dynamic lookback" the feature needs, so
 * a short day costs one request and a long gap keeps expanding up to the cap.
 *
 * `hitCap` distinguishes the two ways this ends without a marker: the search
 * ran out of budget (there may well be more log above) or it ran out of
 * channel. Only the first is worth warning about.
 */
async function scrapeLogLines(channel, userId) {
  const collected = [];
  let before;
  let reachedChannelStart = false;

  while (collected.length < config.maxMessages) {
    const limit = Math.min(100, config.maxMessages - collected.length);
    const page = await channel.messages.fetch({ limit, ...(before ? { before } : {}) });
    if (page.size === 0) {
      reachedChannelStart = true;
      break;
    }

    for (const message of page.values()) {
      collected.push({
        content: message.content,
        authorId: message.author.id,
        createdAt: message.createdAt,
      });
      before = message.id;
    }

    const result = collectLogLines(collected, userId);
    if (result.markerFound) return { ...result, messagesScanned: collected.length, hitCap: false };
    if (page.size < limit) {
      reachedChannelStart = true;
      break;
    }
  }

  return {
    ...collectLogLines(collected, userId),
    messagesScanned: collected.length,
    hitCap: !reachedChannelStart,
  };
}


async function handleLink(interaction) {
  const result = await api.createLinkCode(interaction.user.id, interaction.user.tag);
  if (!result.ok) {
    await interaction.editReply(`could not reach the calendar :( (error: ${result.error || result.status}).`);
    return;
  }

  const relinkNote = result.currentUsername
    ? `\n\nthis discord account is currently linked to **${result.currentUsername}**. redeeming a new code replaces it!`
    : '';

  await interaction.editReply(
    `your code is **${result.code}**, good for 15 minutes.\n\n` +
      `paste it into the Discord Bot section at ${config.publicUrl}/settings${relinkNote}`,
  );
}

async function handleWhoami(interaction) {
  const result = await api.getLinkStatus(interaction.user.id);
  if (!result.ok) {
    await interaction.editReply(`Could not reach the calendar :( (error: ${result.error || result.status}).`);
    return;
  }

  if (!result.linked) {
    await interaction.editReply('not linked yet, run `/link` to hook this up to your calendar.');
    return;
  }

  // No zone means the link predates them being recorded; the app reads those
  // logs in the calendar's own zone until the link is remade.
  const zone = result.timeZone
    ? `times are read in **${result.timeZone}**.`
    : 'no timezone on this link, so times fall back to the calendar\'s own. run `/link` again to set it.';

  const marker = result.postMarker
    ? '\na `---` gets posted after you approve.'
    : '\nno `---` gets posted after you approve.';

  await interaction.editReply(`linked to **${result.username}**, ${zone} ${marker}`);
}

async function handleMarker(interaction) {
  const enabled = interaction.options.getBoolean('on');
  const result = await api.setMarkerPreference(interaction.user.id, enabled);

  if (!result.ok) {
    await interaction.editReply(
      result.error === 'not_linked'
        ? 'not linked yet, run `/link` first.'
        : `could not reach the calendar :( (error: ${result.error || result.status}).`,
    );
    return;
  }

  await interaction.editReply(
    enabled
      ? 'ok, a `---` will be posted after you approve a staged log.'
      : "ok, no more `---` after approving. you'll want to post your own.",
  );
}

async function handleFetch(interaction) {
  const status = await api.getLinkStatus(interaction.user.id);
  if (status.ok && !status.linked) {
    await interaction.editReply('not linked yet, run `/link` first.');
    return;
  }

  const { lines, markerFound, oldestAt, messagesScanned, hitCap } = await scrapeLogLines(
    interaction.channel,
    interaction.user.id,
  );

  if (lines.length === 0) {
    await interaction.editReply(
      (markerFound
        ? 'nothing new since the last `---`.'
        : `couldn't find any log lines in the last ${messagesScanned} messages.`) +
        capWarning(markerFound, hitCap, messagesScanned),
    );
    return;
  }

  const result = await api.stageLog({
    discordUserId: interaction.user.id,
    channelId: interaction.channelId,
    text: lines.join('\n'),
    dateOverride: interaction.options.getString('date') || null,
    // An instant. Which day it falls on is the app's call, using the timezone
    // recorded on the link — the bot serves several people and has no one zone.
    fallbackAt: oldestAt ? oldestAt.toISOString() : null,
  });

  if (!result.ok) {
    await interaction.editReply(
      result.error === 'not_linked'
        ? 'not linked yet, run `/link` first.'
        : `couldn't stage that :( ${result.error || result.status}`,
    );
    return;
  }

  const boundary = markerFound ? 'since the last `---`' : `from the last ${messagesScanned} messages`;
  const preview = lines.slice(0, 10).join('\n');
  const elided = lines.length > 10 ? `\n...and ${lines.length - 10} more` : '';

  await interaction.editReply({
    content:
      `staged **${result.count}** events on **${result.dateUsed}** (${result.timeZone}) ` +
        `for **${result.username}**, ${boundary}.\n` +
        `approve them at ${config.publicUrl}/calendar/${result.dateUsed}` +
        (config.postMarker ? ". \nthere will be a `---` posted here once you do :)" : '') +
        '\n\n' +
        '```\n' + `${preview}${elided}` + '\n```' +
        capWarning(markerFound, hitCap, messagesScanned),
    components: [clearButtonRow()],
  });
}

async function clearStaged(discordUserId) {
  const result = await api.clearStaged(discordUserId);
  if (!result.ok) {
    return result.error === 'not_linked'
      ? 'not linked yet, run `/link` first.'
      : `could not reach the calendar :( (error: ${result.error || result.status}).`;
  }
  return result.count === 0
    ? 'nothing staged, nothing to clear.'
    : `cleared **${result.count}** staged events from **${result.username}**.`;
}

async function handleClear(interaction) {
  await interaction.editReply(await clearStaged(interaction.user.id));
}

// A header the calendar's own paste form understands: it reads the date off
// the line above the separator, so the printed block carries its day with it.
function dateHeader(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return [`log — ${month}/${day}/${year}`, '---'];
}

async function handleManualFetch(interaction) {
  const { lines, markerFound, messagesScanned, hitCap, oldestAt } = await scrapeLogLines(
    interaction.channel,
    interaction.user.id,
  );

  const warning = capWarning(markerFound, hitCap, messagesScanned);

  if (lines.length === 0) {
    await interaction.editReply(
      (markerFound
        ? 'nothing new since the last `---`.'
        : `couldn't find any log lines in the last ${messagesScanned} messages.`) + warning,
    );
    return;
  }

  const boundary = markerFound ? 'since the last `---`' : `from the last ${messagesScanned} messages`;

  // Same zone /fetch would have used, so the printed day matches what staging
  // would have picked. Unlinked, there is no zone and no default.
  const status = await api.getLinkStatus(interaction.user.id);
  const zone = status.ok ? status.timeZone : null;
  const dateStr =
    interaction.options.getString('date') ||
    (oldestAt && zone ? dateStrInZone(oldestAt, zone) : null);

  const body = dateStr ? [...dateHeader(dateStr), ...lines] : lines;
  // Room for the code fences and the trailing newline inside the 2000 budget.
  const chunks = chunkLines(body, 1900);

  await interaction.editReply(
    `**${lines.length}** lines ${boundary}` +
      (dateStr ? `, dated **${dateStr}**` : '') +
      '. note: nothing was staged.' +
      warning,
  );

  for (const chunk of chunks) {
    await interaction.followUp({
      content: '```\n' + chunk.join('\n') + '\n```',
      flags: MessageFlags.Ephemeral,
    });
  }
}

const handlers = {
  link: handleLink,
  whoami: handleWhoami,
  fetch: handleFetch,
  marker: handleMarker,
  'manual-fetch': handleManualFetch,
  clear: handleClear,
};

// The button under a /fetch reply. Ephemeral, so only the person who fetched
// can press it; the reply loses the button once used.
async function handleClearButton(interaction) {
  await interaction.deferUpdate();
  try {
    const message = await clearStaged(interaction.user.id);
    await interaction.editReply({ components: [] });
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('clear button failed:', error);
    await interaction
      .followUp({ content: 'something broke :( check the bot logs.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === CLEAR_BUTTON_ID) {
    await handleClearButton(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const handler = handlers[interaction.commandName];
  if (!handler) return;

  // Every reply is ephemeral: a link code is a secret, and someone else's
  // staged day is nobody's business in a shared channel.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await handler(interaction);
  } catch (error) {
    console.error(`/${interaction.commandName} failed:`, error);
    await interaction.editReply('something broke :( check the bot logs.').catch(() => {});
  }
});

/**
 * Posts the `---` for every batch the user has approved since the last check.
 *
 * Deliberately after approval rather than at stage time: a marker drawn under
 * a log that then gets discarded would hide those lines from the next /fetch
 * for good.
 */
async function postApprovedMarkers() {
  const result = await api.listApprovedMarkers();
  if (!result.ok || result.markers.length === 0) return;

  const posted = [];
  for (const marker of result.markers) {
    try {
      const channel = await client.channels.fetch(marker.discordChannelId);
      await channel.send('---');
      posted.push(marker.id);
    } catch (error) {
      // Left unacknowledged so the next poll retries it; the app drops rows
      // that stay stuck for a week.
      console.error(`Could not post marker in ${marker.discordChannelId}:`, error.message);
    }
  }

  await api.acknowledgeMarkers(posted);
}

client.once('clientReady', async (readyClient) => {
  // Registered globally rather than per guild, so the bot works the moment
  // it's added to another server.
  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
  console.log(`Logged in as ${readyClient.user.tag}; ${commands.length} commands registered.`);

  if (config.postMarker) {
    setInterval(() => {
      postApprovedMarkers().catch((error) => console.error('Marker poll failed:', error));
    }, config.markerPollSeconds * 1000);
  }
});

client.login(config.token);
