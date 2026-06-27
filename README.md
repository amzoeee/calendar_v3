# Calendar

A personal calendar app with daily and weekly timeline views, tag-based event organization, recurring events, and Discord log import.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS, SQLite, and Drizzle ORM.

## Features

- **Daily & weekly timeline views** with zoom (Cmd +/-) and keyboard navigation (arrow keys)
- **Event management** — create, edit, copy, delete via click-to-popover
- **Recurring events** — edit or delete a single occurrence or the whole series
- **Tags** — color-coded, drag-to-reorder, archivable, with usage stats
- **Discord log import** — paste a Discord message export and preview parsed events before committing
- **ICS import/export** — standard calendar format for interop with other apps
- **Pending events** — mark events as unconfirmed, shown with a dashed border

## Setup

**Requirements:** Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and set SECRET_KEY to a random 64-char hex string:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Place your database in the project root
#    (or start fresh — the app will create calendar.db on first run)

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

The app uses a SQLite file at `calendar.db` in the project root. It is not committed to git. Copy it manually between machines.

To run migrations after a schema change:

```bash
npx drizzle-kit push
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
