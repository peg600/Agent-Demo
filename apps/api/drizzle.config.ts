import { defineConfig } from 'drizzle-kit';
import { loadRootEnv } from './src/config.js';

loadRootEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Set DATABASE_URL in the root .env before using database commands.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: false,
});
