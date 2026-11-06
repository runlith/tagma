import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { blockOf, resolve } from './contract/wire/resolve.js';

const STYLESHEET = resolvePath(import.meta.dir, '../../../app/src/tokens.generated.css');

const light = resolve(undefined, 'light').tokens;
const lit = new Map(light);
const dark = resolve(undefined, 'dark').tokens.filter(([name, value]) => lit.get(name) !== value);
const text = `${blockOf(':root', light)}\n${blockOf('.dark', dark)}`;

const canonical = (css: string): string => css.replace(/\s+/gu, '');
const standing = await readFile(STYLESHEET, 'utf8').catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const current = standing !== null && canonical(standing) === canonical(text);

if (process.argv.includes('--check')) {
  if (!current) {
    console.error('apps/tagma/app/src/tokens.generated.css is stale: run bun apps/tagma/server/src/appearance/stylesheet.ts');
    process.exit(1);
  }
} else if (current) console.log('Tagma’s stylesheet is current.');
else {
  await writeFile(STYLESHEET, text);
  console.log('Wrote apps/tagma/app/src/tokens.generated.css.');
}
