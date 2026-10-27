import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MODULE = /^\/\/ (\S+\.[cm]?[jt]sx?)$/gm;
const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
const appendFileSync =
  (fs.appendFileSync as unknown as Record<symbol, typeof fs.appendFileSync>)[Symbol.for('runlith.testbed.original')] ?? fs.appendFileSync;
const record = process.env['RUNLITH_CHANGE_SPAWNED'];
const root = process.env['RUNLITH_CHANGE_SPAWNED_ROOT'] ?? '';
const modules = (path: string): string[] => [...readFileSync(path, 'utf8').matchAll(MODULE)].map((match) => match[1]!);
if (record !== undefined)
  if (process.env['RUNLITH_CHANGE_SPAWNED_CHILD'] === record) {
    const main = Bun.main;
    const own = main.startsWith(`${root}/`) && !main.includes('/node_modules/');
    const marked = !own && existsSync(main) ? modules(main) : [];
    const bundled =
      marked.length === 0
        ? null
        : [
            ...new Set(
              readdirSync(dirname(main))
                .filter((name) => /\.[cm]?[jt]sx?$/.test(name))
                .flatMap((name) => modules(join(dirname(main), name))),
            ),
          ];
    appendFileSync(record, `${JSON.stringify({ main, bundled })}\n`);
  } else {
    process.env['RUNLITH_CHANGE_SPAWNED_CHILD'] = record;
    const preload = `--preload=${import.meta.path}`;
    const options = process.env['BUN_OPTIONS'] ?? '';
    if (!options.split(' ').includes(preload)) process.env['BUN_OPTIONS'] = [options, preload].filter(Boolean).join(' ');
  }
