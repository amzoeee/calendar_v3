// Per-person log channels in one server: /register links someone to a channel,
// talking there keeps the active role, and going quiet for long enough moves
// the channel to the archive until /restore. All of it is off unless
// DISCORD_GUILD_ID is set (see config.js).
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const config = require('./config');

const settings = config.serverChannels;

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('link yourself to a log channel, or get a new one')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('an existing channel to claim. leave empty to get a new one.')
        .addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder()
    .setName('restore')
    .setDescription('bring your archived channel back and become active again'),
  new SlashCommandBuilder()
    .setName('force-register')
    .setDescription('(admin) link someone to a channel')
    .addUserOption((option) => option.setName('user').setDescription('who to link').setRequired(true))
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('channel to link them to. leave empty to make a new one.')
        .addChannelTypes(ChannelType.GuildText),
    ),
].map((command) => command.toJSON());

// { [discordUserId]: { channelId, since } }. `since` is when they were last
// (re)activated, so a fresh channel isn't archived before anyone talks in it.
const storePath = settings ? path.join(settings.dataDir, 'registrations.json') : null;
let registrations = {};

function load() {
  try {
    registrations = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function save() {
  fs.mkdirSync(settings.dataDir, { recursive: true });
  const tmp = `${storePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registrations, null, 2));
  fs.renameSync(tmp, storePath);
}

function ownerOf(channelId) {
  return Object.keys(registrations).find((userId) => registrations[userId].channelId === channelId) || null;
}

async function botLog(guild, text) {
  if (!settings.logChannelId) return;
  try {
    const channel = await guild.channels.fetch(settings.logChannelId);
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Could not write to the bot log channel:', error.message);
  }
}

const ownerPermissions = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
};

async function setActiveRole(guild, userId, active) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.roles.cache.has(settings.activeRoleId) === active) return false;
  if (active) await member.roles.add(settings.activeRoleId);
  else await member.roles.remove(settings.activeRoleId);
  return true;
}

// Into the active category with its permissions, plus the owner's own.
async function activate(channel, userId) {
  if (channel.parentId !== settings.activeCategoryId) {
    await channel.setParent(settings.activeCategoryId, { lockPermissions: true });
  }
  await channel.permissionOverwrites.edit(userId, ownerPermissions);
  await setActiveRole(channel.guild, userId, true);
  registrations[userId] = { channelId: channel.id, since: Date.now() };
  save();
}

// Only the owner and admins can see an archived channel.
async function archive(channel, userId) {
  await channel.setParent(settings.archiveCategoryId, { lockPermissions: false });
  await channel.permissionOverwrites.set([
    { id: channel.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...(settings.adminRoleId ? [{ id: settings.adminRoleId, allow: [PermissionFlagsBits.ViewChannel] }] : []),
  ]);
  await setActiveRole(channel.guild, userId, false);
}

async function createChannelFor(guild, user) {
  return guild.channels.create({
    name: user.username,
    type: ChannelType.GuildText,
    parent: settings.activeCategoryId,
  });
}

function isAdmin(interaction) {
  if (settings.adminRoleId && interaction.member.roles.cache.has(settings.adminRoleId)) return true;
  return interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
}

async function handleRegister(interaction) {
  const userId = interaction.user.id;
  const existing = registrations[userId];
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) {
      const archived = channel.parentId === settings.archiveCategoryId;
      await interaction.editReply(
        `you're already registered to <#${channel.id}>.` + (archived ? ' it\'s archived, run `/restore` to bring it back.' : ''),
      );
      return;
    }
    // Their channel was deleted out from under them; start over.
    delete registrations[userId];
  }

  let channel = interaction.options.getChannel('channel');
  if (channel) {
    const claimable = [settings.activeCategoryId, settings.archiveCategoryId].includes(channel.parentId);
    if (!claimable) {
      await interaction.editReply('you can only claim a channel in the log channel or archive categories.');
      return;
    }
    const owner = ownerOf(channel.id);
    if (owner) {
      await interaction.editReply(`<#${channel.id}> already belongs to someone else.`);
      return;
    }
  } else {
    channel = await createChannelFor(interaction.guild, interaction.user);
  }

  await activate(channel, userId);
  await botLog(interaction.guild, `:link: <@${userId}> registered to <#${channel.id}>.`);
  await interaction.editReply(`you're registered to <#${channel.id}>. talk there at least once a week to stay active!`);
}

async function handleRestore(interaction) {
  const userId = interaction.user.id;
  const registration = registrations[userId];
  const channel = registration && (await interaction.guild.channels.fetch(registration.channelId).catch(() => null));
  if (!channel) {
    await interaction.editReply('you have no channel yet, run `/register` first.');
    return;
  }
  if (channel.parentId !== settings.archiveCategoryId) {
    await interaction.editReply(`<#${channel.id}> isn't archived.`);
    return;
  }

  await activate(channel, userId);
  await botLog(interaction.guild, `:recycle: <@${userId}> restored <#${channel.id}>.`);
  await interaction.editReply(`<#${channel.id}> is back, welcome back :)`);
}

async function handleForceRegister(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.editReply('only admins can do that.');
    return;
  }

  const user = interaction.options.getUser('user');
  const channel = interaction.options.getChannel('channel') || (await createChannelFor(interaction.guild, user));

  const previousOwner = ownerOf(channel.id);
  if (previousOwner && previousOwner !== user.id) delete registrations[previousOwner];

  await activate(channel, user.id);
  await botLog(
    interaction.guild,
    `:link: <@${interaction.user.id}> registered <@${user.id}> to <#${channel.id}>` +
      (previousOwner && previousOwner !== user.id ? `, replacing <@${previousOwner}>.` : '.'),
  );
  await interaction.editReply(`<@${user.id}> is registered to <#${channel.id}>.`);
}

const handlers = {
  register: handleRegister,
  restore: handleRestore,
  'force-register': handleForceRegister,
};

// Talking in your own active channel is what keeps the role.
async function onMessage(message) {
  if (message.author.bot || message.guildId !== settings.guildId) return;
  const registration = registrations[message.author.id];
  if (!registration || registration.channelId !== message.channelId) return;
  if (message.channel.parentId !== settings.activeCategoryId) return;
  if (message.member?.roles.cache.has(settings.activeRoleId)) return;

  if (await setActiveRole(message.guild, message.author.id, true)) {
    await botLog(message.guild, `:green_circle: <@${message.author.id}> is active again.`);
  }
}

/**
 * Newest message the owner posted in their channel, or null if there is none
 * since `cutoff`. Pages back only until messages get older than that.
 */
async function lastPostedAt(channel, userId, cutoff) {
  let before;
  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    for (const message of page.values()) {
      if (message.createdTimestamp < cutoff) return null;
      if (message.author.id === userId) return message.createdTimestamp;
      before = message.id;
    }
    if (page.size < 100) return null;
  }
}

async function sweep(client) {
  const guild = await client.guilds.fetch(settings.guildId);
  const cutoff = Date.now() - settings.inactiveAfterDays * 24 * 60 * 60 * 1000;

  for (const [userId, registration] of Object.entries(registrations)) {
    try {
      const channel = await guild.channels.fetch(registration.channelId).catch(() => null);
      if (!channel) {
        delete registrations[userId];
        save();
        await botLog(guild, `:wastebasket: <@${userId}>'s channel is gone, so they're no longer registered.`);
        continue;
      }
      if (channel.parentId !== settings.activeCategoryId) continue;

      const active = registration.since >= cutoff || (await lastPostedAt(channel, userId, cutoff)) !== null;
      if (active) {
        if (await setActiveRole(guild, userId, true)) {
          await botLog(guild, `:green_circle: <@${userId}> is active again.`);
        }
        continue;
      }

      await archive(channel, userId);
      await botLog(
        guild,
        `:file_cabinet: archived <#${channel.id}>: <@${userId}> hasn't posted in ${settings.inactiveAfterDays} days.`,
      );
    } catch (error) {
      console.error(`Activity check for ${userId} failed:`, error.message);
    }
  }
}

function start(client) {
  load();
  const run = () => sweep(client).catch((error) => console.error('Activity check failed:', error));
  run();
  setInterval(run, settings.checkMinutes * 60 * 1000);
}

module.exports = { commands, handlers, onMessage, start };
