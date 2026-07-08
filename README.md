# Calendar

A personal calendar web app you run on your own computer (or server). It gives you daily and weekly timeline views, color-coded tags, recurring events, Discord log import, and ICS import/export.

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

The first time it runs, the app automatically creates an empty database file (`calendar.db`) in the project folder.

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

4. **Start the app** with `npm run dev` and log in with your existing username and password. Your old credentials will work -- the app understands the password format used by both versions.



---

## Features

| Feature | Description |
|---|---|
| Daily & weekly views | Switch between day and week timelines; zoom in/out with Cmd+/Cmd- |
| Keyboard navigation | Arrow keys to move between days/weeks |
| Event management | Click on the timeline to create events; click events to edit or delete |
| Recurring events | Create repeating events; edit/delete a single occurrence or the whole series |
| Tags | Color-coded labels; drag to reorder; archive old ones |
| Discord log import | Paste a Discord message export to bulk-create events |
| ICS import/export | Standard calendar format for sharing with other apps (Google Calendar, Apple Calendar, etc.) |
| Pending events | Mark events as unconfirmed (shown with reduced opacity) |

