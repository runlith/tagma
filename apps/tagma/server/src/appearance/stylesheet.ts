import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { THEME_MODES } from './contract/wire/format.js';
import { blockOf, resolve } from './contract/wire/resolve.js';

const APP = resolvePath(import.meta.dir, '../../../app');
const STYLESHEET = 'src/tokens.generated.css';
const PAGE = 'src/app.html';
const MANIFEST = 'static/manifest.webmanifest';

const light = resolve(undefined, 'light').tokens;
const lit = new Map(light);
const dark = resolve(undefined, 'dark').tokens.filter(([name, value]) => lit.get(name) !== value);
const chrome = Object.fromEntries(THEME_MODES.map((mode) => [mode, resolve(undefined, mode).chrome]));

const META = /(<meta name="theme-color" media="\(prefers-color-scheme: (light|dark)\)" content=")[^"]*(")/gu;

type Pinned = { readonly path: string; readonly current: (standing: string) => boolean; readonly written: (standing: string) => string };

const canonical = (css: string): string => css.replace(/\s+/gu, '');
const sheet = `${blockOf(':root', light)}\n${blockOf('.dark', dark)}`;
const page = (standing: string): string =>
  standing.replace(META, (_whole, head: string, mode: string, tail: string) => `${head}${chrome[mode]}${tail}`);
const manifest = (standing: string): Record<string, unknown> => ({
  ...(JSON.parse(standing) as Record<string, unknown>),
  background_color: chrome.light,
  theme_color: chrome.light,
});

const PINNED: readonly Pinned[] = [
  { path: STYLESHEET, current: (standing) => canonical(standing) === canonical(sheet), written: () => sheet },
  { path: PAGE, current: (standing) => page(standing) === standing, written: page },
  {
    path: MANIFEST,
    current: (standing) => Bun.deepEquals(JSON.parse(standing), manifest(standing)),
    written: (standing) => `${JSON.stringify(manifest(standing), null, 2)}\n`,
  },
];

const stale: string[] = [];
for (const pinned of PINNED) {
  const file = resolvePath(APP, pinned.path);
  const standing = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (standing !== '' && pinned.current(standing)) continue;
  stale.push(`apps/tagma/app/${pinned.path}`);
  if (!process.argv.includes('--check')) await writeFile(file, pinned.written(standing));
}

if (process.argv.includes('--check')) {
  if (stale.length > 0) {
    console.error(`${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} stale: run bun apps/tagma/server/src/appearance/stylesheet.ts`);
    process.exit(1);
  }
} else console.log(stale.length === 0 ? 'Tagma’s own look is current in the app.' : `Wrote ${stale.join(', ')}.`);
