# Calendar Discord bot

A "go fetch" bot: it reads your shorthand log lines out of a Discord channel
and stages them in the calendar as pending events, which you then approve in
the web UI. Nothing it does writes to your calendar directly.

## Commands

| Command | What it does |
| --- | --- |
| `/link` | Gives you a one-time code to connect this Discord account to a calendar account. |
| `/whoami` | Says which calendar account this Discord account is linked to. |
| `/fetch [date] [merge] [military]` | Reads back through the channel until it hits a `---` marker, takes your lines that start with a valid time, and stages them. |
| `/marker on:true\|false` | Choose whether a `---` gets posted in the channel after you approve a staged log. |
| `/manual-fetch [date] [merge]` | Same scan as `/fetch`, but prints the lines back to you instead of staging anything. For copy-pasting somewhere else. |
| `/debug-fetch [date] [merge] [military] [user]` | Server admins only. Same scan as `/fetch`, but takes lines from `user` (or from everyone if left empty), stages them into **your** calendar, and lists every event it made with its calculated time. Never posts a `---`. |
| `/clear` | Throws away every event you have staged but not approved yet, same as discarding in the web UI. The reply to a `/fetch` also has a button that does this. |

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
exactly where this one stopped. `/marker on:false` turns that off for your
account alone — everyone else sharing the bot keeps their own setting, and
`/whoami` shows yours. With it off you need to post markers yourself, or
`/fetch` will keep re-reading the same lines. Discarding the batch (in the web UI or with `/clear`) posts nothing: a marker
drawn under a log you threw away would hide those lines from the next `/fetch`
for good. Approval happens in a browser, so the bot asks the app every
`MARKER_POLL_SECONDS` whether anything it staged has been approved since. Set
`FETCH_POST_MARKER=false` if you would rather post markers yourself.

`/fetch` won't stage anything while an earlier batch is still waiting;
approve it, or `/clear` it and fetch again.

Dates come from the log itself if it has one, otherwise from the day you posted
the oldest line it took. `/fetch date:2026-09-19` overrides both.

`merge:true` collapses back-to-back lines with the same name into one event.
A line's time is when that activity ended, so the last of the run is kept:
`1400 study` then `1500 study` becomes one study event ending at 1500. Names
match ignoring case.

`military:false` stops reading a leading 0 as 24h. By default `0145` is
always 1:45am; with it off, `0145` is treated like `145` and lands on whichever
of 1:45am or 1:45pm comes next. Times like `1430` or `0030` are still 24h.

`/manual-fetch` heads its output with that date and a `---`, which is the shape
the calendar's own paste form reads, so the block you copy carries its day with
it. `/manual-fetch date:2026-09-19` sets that header.

## Timezones

Discord exposes no timezone, and one bot serves people in several of them, so
there is no bot-wide setting. Each link records the timezone of the browser
that redeemed its code, and that is the zone your logged times and the day they
fall on are read in. The Settings page shows which zone a link carries;
re-linking from a machine in another zone changes it. Links made before this
existed show no zone and fall back to the calendar's own.

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

Standalone, against a local `npm run dev` calendar:

```bash
cd bot
npm install
npm run dev
```

`npm run dev` reads the repo's own `.env`, so put `DISCORD_BOT_TOKEN`,
`DISCORD_BOT_SECRET` and `CALENDAR_API_URL=http://localhost:3000` there
alongside `SECRET_KEY`.

## Environment

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | — | Bot token from the Discord developer portal. |
| `DISCORD_BOT_SECRET` | yes | — | Shared secret; must match the app's. |
| `CALENDAR_API_URL` | no | `http://app:4000` | Where the bot reaches the calendar. |
| `CALENDAR_PUBLIC_URL` | no | `CALENDAR_API_URL` | URL used in links shown to people. |
| `CALENDAR_TIMEZONE` | no | `America/Los_Angeles` | Zone the scraped times are read in. |
| `FETCH_MAX_MESSAGES` | no | `500` | How far back `/fetch` will look for a marker. |
| `FETCH_POST_MARKER` | no | `true` | Kill switch for markers across the whole bot. Individual accounts opt out with `/marker`. |
| `MARKER_POLL_SECONDS` | no | `15` | How often it checks for newly approved batches. |
