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
| `/log name` | Posts `<current time> name` in the channel as a log line, e.g. `2:30pm study`. |
| `/manual-fetch [date] [merge]` | Same scan as `/fetch`, but prints the lines back to you instead of staging anything. For copy-pasting somewhere else. |
| `/debug-fetch [date] [merge] [military] [user]` | Server admins only. Same scan as `/fetch`, but takes lines from `user` (or from everyone if left empty), stages them into **your** calendar, and lists every event it made with its calculated time. Never posts a `---`. |
| `/clear` | Throws away every event you have staged but not approved yet, same as discarding in the web UI. The reply to a `/fetch` also has a button that does this. |

All replies are ephemeral — only you see them — except `/log`'s line, which is
posted to the channel.

## `/log`

The time is the current time in your link's timezone, written with am/pm
(`2:30pm`) so it reads the same whatever `military` is set to. It's plain text rather than a Discord
timestamp, so it copies cleanly and `/fetch` can read it. The line is the bot's
message, but `/fetch` counts it as yours.

A line's time marks when that activity ended. So if your last `/log` since the
last `---` has the same name (ignoring case), the bot deletes it and the new
line covers both — one event instead of two. Only its own `/log` messages get
deleted, never lines you typed yourself.

A time is read as the next time that clock reading comes round, so two lines
in a row with the same time put the second a full day later. `/log` still
posts the line but privately warns you when your previous line has the same
time and a different name. The warning has buttons to delete the new line, or
the earlier one if `/log` posted that too — only the bot can delete its own
messages. A line you typed yourself you delete as usual.

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

## Per-person log channels (one server only)

Off unless `DISCORD_GUILD_ID` is set. In that server only, three more commands
appear — they're registered to that server alone, so no other server sees them:

| Command | What it does |
| --- | --- |
| `/register [channel]` | Links you to a channel. With no channel you get a new one named after you in the log channel category; with one, it has to be an unclaimed channel in the log channel or archive category. |
| `/restore` | Moves your archived channel back and gives you the active role again. |
| `/force-register user [channel]` | Admins only. Links anyone to any channel (or a new one), taking it from whoever had it. |

- **Active role:** posting in your own channel gives you `DISCORD_ACTIVE_ROLE_ID`.
- **Archiving:** every `ACTIVITY_CHECK_MINUTES` the bot checks each registered
  channel. If its owner hasn't posted there in `INACTIVE_AFTER_DAYS` (and
  wasn't registered or restored in that time), the channel moves to the archive
  category, only its owner and admins can see it, and the role is removed.
  Posting in an archived channel doesn't bring it back; `/restore` does.
- **Permissions:** an active channel takes the log channel category's
  permissions plus view/send for its owner. Set the category up the way you
  want every channel in it to look.
- **Bot log:** registrations, restores, archives and role changes are posted to
  `DISCORD_LOG_CHANNEL_ID` without pinging anyone.
- Registrations (who owns which channel) live in `data/registrations.json`,
  a volume in Docker. A channel deleted by hand is dropped on the next check.

Setup in the server: the bot needs **Manage Channels** and **Manage Roles**
on top of the permissions below, and its own role must sit **above** the active
role in Server Settings -> Roles, or Discord won't let it hand that role out.

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
   scopes, then the `Send Messages` and `Read Message History` bot permissions
   (plus `Manage Channels` and `Manage Roles` for the per-person log channels).
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
| `DISCORD_GUILD_ID` | no | — | Server the per-person log channels run in. Unset turns them off. |
| `DISCORD_ACTIVE_ROLE_ID` | with guild | — | Role for people who posted in their channel recently. |
| `DISCORD_ACTIVE_CATEGORY_ID` | with guild | — | Category active log channels live in. |
| `DISCORD_ARCHIVE_CATEGORY_ID` | with guild | — | Category inactive channels are moved to. |
| `DISCORD_ADMIN_ROLE_ID` | no | — | Who can `/force-register`. Without it, anyone with Administrator. |
| `DISCORD_LOG_CHANNEL_ID` | no | — | Where the bot records what it did. |
| `INACTIVE_AFTER_DAYS` | no | `7` | Quiet days before a channel is archived. |
| `ACTIVITY_CHECK_MINUTES` | no | `60` | How often it checks. |
| `BOT_DATA_DIR` | no | `bot/data` | Where registrations are stored. |
