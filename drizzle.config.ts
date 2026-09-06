import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    // Same default and same override as src/db/index.ts, so running drizzle-kit
    // by hand hits the database the app is actually using.
    url: process.env.DATABASE_PATH || 'calendar.db',
  },
});
