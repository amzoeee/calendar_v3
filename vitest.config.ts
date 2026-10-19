import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Pinned so tests that read Date's local getters don't depend on the machine's zone.
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'bot/**/*.test.js'],
    environment: 'node',
  },
});
