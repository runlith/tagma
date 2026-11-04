import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARD_TIMINGS, TIMINGS, type Timings } from '@runlith/testbed/timings';
import { packagesOf, workspacePaths } from './packages.ts';

const [verb, into, ...from] = process.argv.slice(2);
if (into === undefined || (verb !== 'collect' && verb !== 'merge') || (verb === 'merge' && from.length === 0)) {
  console.error('usage: bun scripts/change/timings.ts collect <into> | merge <into> <from>...');
  process.exit(2);
}
const root = process.cwd();
const directories = packagesOf(workspacePaths(root), (path) => readFileSync(join(root, path), 'utf8')).map((pkg) => pkg.dir);

if (verb === 'collect') {
  for (const directory of directories)
    for (const name of readdirSync(join(root, directory)).filter((name) => SHARD_TIMINGS.test(name))) {
      mkdirSync(join(into, directory), { recursive: true });
      copyFileSync(join(root, directory, name), join(into, directory, name));
    }
} else {
  for (const directory of directories) {
    const files: Record<string, number> = {};
    for (const source of from) {
      const at = join(source, directory);
      if (!existsSync(at)) continue;
      const names = readdirSync(at)
        .filter((name) => name === TIMINGS || SHARD_TIMINGS.test(name))
        .sort((a, b) => Number(b === TIMINGS) - Number(a === TIMINGS));
      for (const name of names) Object.assign(files, (JSON.parse(readFileSync(join(at, name), 'utf8')) as Timings).files);
    }
    const kept = Object.entries(files)
      .filter(([file]) => existsSync(join(root, directory, file)))
      .sort(([a], [b]) => a.localeCompare(b));
    if (kept.length === 0) continue;
    mkdirSync(join(into, directory), { recursive: true });
    writeFileSync(join(into, directory, TIMINGS), `${JSON.stringify({ version: 1, files: Object.fromEntries(kept) }, null, 2)}\n`);
  }
}
