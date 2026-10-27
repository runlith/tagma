import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MODULE = /^\/\/ (\S+\.[cm]?[jt]sx?)$/gm;
const record = process.env['RUNLITH_CHANGE_SPAWNED'];
const root = process.env['RUNLITH_CHANGE_SPAWNED_ROOT'] ?? '';
const modules = (path: string): string[] => [...readFileSync(path, 'utf8').matchAll(MODULE)].map((match) => match[1]!);
if (record !== undefined)
  if (process.env['RUNLITH_CHANGE_SPAWNED_CHILD'] === '1') {
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
    process.env['RUNLITH_CHANGE_SPAWNED_CHILD'] = '1';
    process.env['BUN_OPTIONS'] = [process.env['BUN_OPTIONS'], `--preload=${import.meta.path}`].filter(Boolean).join(' ');
  }
