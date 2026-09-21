# Calendar Discord bot

A "go fetch" bot: it reads your shorthand log lines out of a Discord channel
and stages them in the calendar as pending events, which you then approve in
the web UI. Nothing it does writes to your calendar directly.

## Commands

| Command | What it does |
| --- | --- |
| `/link` | Gives you a one-time code to connect this Discord account to a calendar account. |
| `/whoami` | Says which calendar account this Discord account is linked to. |
| `/fetch [date]` | Reads back through the channel until it hits a `---` marker, takes your lines that start with a valid time, and stages them. |
| `/manual-fetch` | Same scan as `/fetch`, but prints the lines back to you instead of staging anything. For copy-pasting somewhere else. |

All replies are ephemeral — only you see them.

## How `/fetch` decides what to take

It pages back through channel history 100 messages at a time, expanding the
search until it finds a `---` marker or reaches `FETCH_MAX_MESSAGES` — and it
says so when it stops at that limit, since there may be more log above. From
everything newer than that marker it keeps only **your own** messages' lines
that start with a valid shorthand time (`9`, `930`, `0930`, `1430`, optionally
followed by `am`/`pm`), in chronological order. Any line opening with three or more dashes
counts as a marker, whoever posted it — including the bot — so a shared log
channel works fine.

Once you **approve** the staged batch in the calendar, the bot posts a `---` of
its own in the channel it took the lines from, so the next `/fetch` picks up
exactly where this one stopped. Discarding the batch posts nothing: a marker
drawn under a log you threw away would hide those lines from the next `/fetch`
for good. Approval happens in a browser, so the bot asks the app every
`MARKER_POLL_SECONDS` whether anything it staged has been approved since. Set
`FETCH_POST_MARKER=false` if you would rather post markers yourself.

Dates come from the log itself if it has one, otherwise from the day you posted
the oldest line it took. `/fetch date:2026-09-19` overrides both.

## Setting up the Discord application

1. Go to https://discord.com/developers/applications and hit **New Application**.
2. **Bot** -> **Reset Token**, copy the token into `DISCORD_BOT_TOKEN` in `.env`.
3. On the same page, turn on **Message Content Intent** under *Privileged
   Gateway Intents*. Without it every message reads as empty and `/fetch`
   finds nothing.
4. **OAuth2** -> **URL Generator**: tick the `bot` and `applications.commands`
   scopes, then the `Send Messages` and `Read Message History` bot permissions.
   Open the generated URL to add the bot to a server. Repeat for as many
   servers as you like — the bot registers its commands globally and keys
   everything off Discord user IDs, not servers.

## Running it

In Docker, alongside the app (see the repo's `docker-compose.yml`):

```bash
docker compose up -d discord-bot
```

Standalone, for development:

```bash
cd bot
npm install
DISCORD_BOT_TOKEN=... DISCORD_BOT_SECRET=... CALENDAR_API_URL=http://localhost:3000 npm start
```

## Environment

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | — | Bot token from the Discord developer portal. |
| `DISCORD_BOT_SECRET` | yes | — | Shared secret; must match the app's. |
| `CALENDAR_API_URL` | no | `http://app:4000` | Where the bot reaches the calendar. |
| `CALENDAR_PUBLIC_URL` | no | `CALENDAR_API_URL` | URL used in links shown to people. |
| `CALENDAR_TIMEZONE` | no | `America/Los_Angeles` | Zone the scraped times are read in. |
| `FETCH_MAX_MESSAGES` | no | `500` | How far back `/fetch` will look for a marker. |
| `FETCH_POST_MARKER` | no | `true` | Whether the bot posts `---` once a batch is approved. |
| `MARKER_POLL_SECONDS` | no | `15` | How often it checks for newly approved batches. |
