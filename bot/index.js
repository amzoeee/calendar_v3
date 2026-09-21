const {
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

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Get a one-time code to connect this Discord account to your calendar'),
  new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Show which calendar account this Discord account is linked to'),
  new SlashCommandBuilder()
    .setName('manual-fetch')
    .setDescription('Print your log lines since the last --- marker, without staging anything'),
  new SlashCommandBuilder()
    .setName('fetch')
    .setDescription('Read your log lines since the last --- marker and stage them in your calendar')
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('Day the log belongs to (YYYY-MM-DD). Defaults to the day you posted it.'),
    ),
].map((command) => command.toJSON());

const client = new Client({
  // MessageContent is privileged: enable it on the bot's page in the Discord
  // developer portal, or /fetch reads every message as empty.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function dateStrInZone(date, timeZone) {
  // en-CA formats as YYYY-MM-DD, which is the shape the calendar wants.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

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
    await interaction.editReply(`Could not reach the calendar (${result.error || result.status}).`);
    return;
  }

  const relinkNote = result.currentUsername
    ? `\n\nThis Discord account is currently linked to **${result.currentUsername}**. Redeeming a new code replaces that.`
    : '';

  await interaction.editReply(
    `Your link code is **${result.code}** — it expires in 15 minutes.\n\n` +
      `Sign in at ${config.publicUrl}/settings and paste it into the **Discord Bot** section.${relinkNote}`,
  );
}

async function handleWhoami(interaction) {
  const result = await api.getLinkStatus(interaction.user.id);
  if (!result.ok) {
    await interaction.editReply(`Could not reach the calendar (${result.error || result.status}).`);
    return;
  }

  await interaction.editReply(
    result.linked
      ? `Linked to calendar account **${result.username}**.`
      : 'Not linked yet. Run `/link` to connect your calendar account.',
  );
}

async function handleFetch(interaction) {
  const status = await api.getLinkStatus(interaction.user.id);
  if (status.ok && !status.linked) {
    await interaction.editReply('Not linked yet. Run `/link` first.');
    return;
  }

  const { lines, markerFound, oldestAt, messagesScanned, hitCap } = await scrapeLogLines(
    interaction.channel,
    interaction.user.id,
  );

  if (lines.length === 0) {
    await interaction.editReply(
      (markerFound
        ? 'No log lines since the last `---` marker.'
        : `No log lines found in the last ${messagesScanned} messages.`) +
        capWarning(markerFound, hitCap, messagesScanned),
    );
    return;
  }

  const result = await api.stageLog({
    discordUserId: interaction.user.id,
    text: lines.join('\n'),
    dateOverride: interaction.options.getString('date') || null,
    fallbackDate: oldestAt ? dateStrInZone(oldestAt, config.timeZone) : null,
    timeZone: config.timeZone,
  });

  if (!result.ok) {
    await interaction.editReply(
      result.error === 'not_linked'
        ? 'Not linked yet. Run `/link` first.'
        : `Could not stage the log: ${result.error || result.status}`,
    );
    return;
  }

  if (config.postMarker) {
    // Closes off what was just taken, so the next /fetch starts here.
    await interaction.channel.send('---');
  }

  const boundary = markerFound ? 'since the last `---`' : `from the last ${messagesScanned} messages`;
  const preview = lines.slice(0, 10).join('\n');
  const elided = lines.length > 10 ? `\n… and ${lines.length - 10} more` : '';

  await interaction.editReply(
    `Staged **${result.count}** pending events on **${result.dateUsed}** for **${result.username}**, ${boundary}.\n` +
      `Approve them at ${config.publicUrl}/calendar/${result.dateUsed}\n\n` +
      '```\n' + `${preview}${elided}` + '\n```' +
      capWarning(markerFound, hitCap, messagesScanned),
  );
}

async function handleManualFetch(interaction) {
  const { lines, markerFound, messagesScanned, hitCap } = await scrapeLogLines(
    interaction.channel,
    interaction.user.id,
  );

  const warning = capWarning(markerFound, hitCap, messagesScanned);

  if (lines.length === 0) {
    await interaction.editReply(
      (markerFound
        ? 'No log lines since the last `---` marker.'
        : `No log lines found in the last ${messagesScanned} messages.`) + warning,
    );
    return;
  }

  const boundary = markerFound ? 'since the last `---`' : `from the last ${messagesScanned} messages`;
  // Room for the code fences and the trailing newline inside the 2000 budget.
  const chunks = chunkLines(lines, 1900);

  await interaction.editReply(
    `**${lines.length}** log lines ${boundary}. Nothing was staged — copy them wherever you need.` +
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
  'manual-fetch': handleManualFetch,
};

client.on('interactionCreate', async (interaction) => {
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
    await interaction.editReply('Something went wrong. Check the bot logs.').catch(() => {});
  }
});

client.once('clientReady', async (readyClient) => {
  // Registered globally rather than per guild, so the bot works the moment
  // it's added to another server.
  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
  console.log(`Logged in as ${readyClient.user.tag}; ${commands.length} commands registered.`);
});

client.login(config.token);
