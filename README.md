# Calendar

A personal calendar web app you run on your own computer (or server). It gives you daily and weekly timeline views, a stats page, color-coded tags, recurring events, event search and ICS import/export.

Built with Next.js, TypeScript, Tailwind CSS, SQLite, and Drizzle ORM.

## What you need before starting

You only need one thing installed: **Node.js** (version 18 or newer).

If you don't have Node.js:

1. Go to https://nodejs.org
2. Download the **LTS** version (the big green button).
3. Run the installer and follow the prompts.
4. When it's done, open a terminal and run `node -v` -- you should see a version number like `v20.x.x`.



## Setup (step by step)

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd calendar_v3
```

### 2. Install dependencies

In your terminal, navigate to the project folder and run:

```bash
npm install
```

This downloads all the libraries the app needs. It may take a minute or two. You'll see a `node_modules` folder appear -- that's normal, don't delete it.

### 3. Create your environment file

The app needs a secret key to keep login sessions secure.

```bash
cp .env.example .env
```

Now open the `.env` file in any text editor. You'll see this line:

```
SECRET_KEY=change-this-to-a-random-64-char-hex-string
```

Replace the value with a random string. You can generate one by running:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste it as the value of `SECRET_KEY`. The file should look something like:

```
SECRET_KEY=a3f7b2c9d1e84f6a0b5c3d7e9f1a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5
```

Save the file.

### 4. Start the app

```bash
npm run dev
```

Open your browser and go to **http://localhost:3000**.

The first time it runs, the app creates the database file (`calendar.db`) in the project folder and builds its tables. Every later start applies any new migrations, so there is no separate database step to remember.

### 5. Create an account

Go to the register page at **http://localhost:3000/register** and create a username and password. You can then log in and start adding events.

---

## Migrating from calendar_v2

If you have an existing `calendar.db` file from calendar_v2 (whether it was the Flask version or the Next.js version), you can bring your data over. The database schema is the same between v2 and v3.

### Steps

1. **Find your old database file.** It's called `calendar.db` and lives in the root of your calendar_v2 project folder.

2. **Copy it into the calendar_v3 folder.** Replace the file at the project root:

   ```bash
   cp /path/to/calendar_v2/calendar.db /path/to/calendar_v3/calendar.db
   ```

   (Replace `/path/to/...` with the actual paths on your computer.)

3. **Sync the database schema.** Run this command from inside the calendar_v3 folder to make sure the database has all the tables and columns v3 expects:

   ```bash
   npx drizzle-kit push
   ```

   If it asks you to confirm changes, type `yes`. If the schemas already match (which they should), it will say there's nothing to do.

   A database set up this way has no migration history, so the app leaves it to `drizzle-kit push` from then on and says so in the terminal on startup. Keep running `npx drizzle-kit push` after you pull schema changes.

4. **Start the app** with `npm run dev` and log in with your existing username and password. Your old credentials will work -- the app understands the password format used by both versions.



---

## Backups

The deployed app backs its database up on its own. Every couple of days it
writes a timestamped copy of `calendar.db` to a folder on the server, outside
the calendar folder and outside the Docker volume holding the live database, so
a bad migration or an accidental `docker compose down -v` can't take the copies
with it.

Old backups are **never** deleted -- every snapshot is kept. The database is
small (a few MB), so a year of them is a couple hundred MB.

This only runs in the Docker deployment. Running the app locally with
`npm run dev` never writes backups.

### One-time setup on the server

Create the folder:

```bash
mkdir -p ~/calendar-backups
```

**Leave it owned by your own user.** The container runs as uid 1001, but under
Docker Desktop (macOS/Windows) the write is carried out on the host as *your*
desktop user, so chowning the folder to 1001 takes write access away rather than
granting it. Only on a plain Linux host, where the container writes as its own
uid, do you need:

```bash
sudo chown 1001:1001 ~/calendar-backups   # Linux hosts only, not Docker Desktop
```

Then add the full path to your `.env` (Compose doesn't understand `~`):

```
BACKUP_HOST_DIR=/home/your-user/calendar-backups
```

Bring the stack up and check it took:

```bash
docker compose up -d
docker compose logs app | grep backup
```

You should see `[backup] enabled` on startup, and `[backup] wrote ...` about
half a minute later the first time. Afterwards each start logs either a skip
with the age of the newest backup, or a fresh one once that age passes two days.

If instead it logs `[backup] disabled`, the message names the cause. The two
likely ones:

- **`BACKUP_DIR is not set`** -- the container predates the backup feature.
  Watchtower updates the image but never re-reads `docker-compose.yml`, so it
  keeps recreating the container with its original settings. `git pull &&
  docker compose up -d app` rebuilds it from the current file.
- **`cannot write to BACKUP_DIR`** -- fix the folder's ownership as above, then
  `docker compose restart app`.

### Restoring from a backup

Pick the snapshot you want from `~/calendar-backups`, then swap it in:

```bash
docker compose stop app
docker run --rm -v calendar_v3_calendar-data:/data -v ~/calendar-backups:/backups \
  alpine cp /backups/calendar-20260819-031500.db /data/calendar.db
docker compose up -d app
```

Replace the filename with the backup you chose. Check the volume's real name
with `docker volume ls` first if the stack wasn't started from a folder called
`calendar_v3` -- Compose prefixes volume names with the folder name.

---

## Discord bot

A bot that reads your shorthand log out of a Discord channel so you don't have
to copy and paste it. `/fetch` pages back through the channel until it hits a
`---` marker, takes your lines that start with a valid time, and stages them
as **pending** events — nothing lands in the calendar until you approve it in
the day view, exactly like a pasted log. Once you approve, the bot posts a
`---` of its own so the next `/fetch` starts where that one stopped.
`/manual-fetch` runs the same scan but just prints the lines back for copying.

`bot/README.md` has the full setup: creating the Discord application, the
intents and permissions it needs, and every environment variable. The short
version:

1. Create a Discord application, copy its bot token into `DISCORD_BOT_TOKEN`
   in `.env`, and turn on the **Message Content Intent**.
2. Put a shared secret in `DISCORD_BOT_SECRET` in the same `.env`. The app
   and the bot both read it; with it unset the app's bot endpoints stay off.
3. Uncomment the `discord-bot` service in `docker-compose.yml` and run
   `docker compose up -d discord-bot`.
4. In Discord, run `/link`, then paste the code it gives you into the
   **Discord Bot** section of the calendar's Settings page.

One bot can serve several servers and several people: commands are registered
globally, and every log is routed by the Discord user who ran `/fetch`.

### If your database was built with `drizzle-kit push`

The bot adds three tables (`discord_links`, `discord_link_codes`,
`discord_stages`). A database
with no Drizzle migration history — which is what the calendar_v2 import above
produces — skips migrations on startup, so run `npx drizzle-kit push` against
it once to pick them up.

---

## Features

| Feature | Description |
|---|---|
| Daily & weekly views | Switch between day and week timelines; zoom in/out with Cmd+/Cmd- |
| Stats page | Weekday breakdown chart and per-tag daily averages over a custom date range, with presets, a weekdays-only toggle, and an active-day count |
| Recurring events | Create repeating events; edit/delete a single occurrence or the whole series |
| Event search | Search for events from the view header and jump straight to them |
| Tags | Color-coded labels; drag to reorder; archive old ones |
| Discord log import | Paste a Discord message export to bulk-create events |
| Discord bot | `/fetch` in Discord pulls your log lines out of a channel and stages them for approval (see below) |
| ICS import/export | Standard calendar format for sharing with other apps (Google Calendar, Apple Calendar, etc.) |
| Mini month calendar | Jump to any day from a small month view, available on the main calendar and Settings page |

