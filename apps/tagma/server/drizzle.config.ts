import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

const tableFiles = readdirSync('./src', { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.ts') && !/\.(test|itest|stest|bench)\.ts$/.test(path) && !path.startsWith('calls/'))
  .map((path) => `./src/${path}`)
  .filter((path) => /\bsqliteTable\(/.test(readFileSync(path, 'utf8')))
  .sort();

export default defineConfig({
  dialect: 'sqlite',
  schema: tableFiles,
  out: './drizzle',
  dbCredentials: {
    url: process.env.TAGMA_DATABASE_PATH ?? ':memory:',
  },
});
