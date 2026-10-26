import { readFileSync } from 'node:fs';

type Frame = { readonly name: string; readonly at: string };
type Row = {
  readonly file: string;
  readonly verb: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly root: { readonly id: string; readonly name: string } | null;
  readonly frames: readonly Frame[] | null;
  readonly js?: readonly string[];
};

const args = process.argv.slice(2);
const topAt = args.indexOf('--top');
const top = topAt === -1 ? 30 : Number(args[topAt + 1]);
const paths = topAt === -1 ? args : args.filter((_, at) => at !== topAt && at !== topAt + 1);
if (paths.length === 0 || !Number.isInteger(top) || top < 1) {
  console.error('usage: bun git-sites-report.ts [--top N] <git-sites.jsonl>...');
  process.exit(2);
}

const rows: Row[] = paths.flatMap((path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Row),
);

const PLUMBING = /^(Git\.spawn|Git\.runEnded|Git\.runBytes|ShadowGit\.answer|ShadowGit\.run|ShadowGit\.quiet)$/;
const short = (at: string): string => at.replace(/^(apps\/tagma\/server\/src|packages)\//, '');

const siteOf = (row: Row): string => {
  const frames = (row.frames ?? []).filter((frame) => !frame.name.endsWith('(definition)'));
  if (frames.length === 0) return `js ${(row.js ?? [])[0] ?? '?'}`;
  const first = frames.findIndex((frame) => !PLUMBING.test(frame.name));
  if (first === -1) return short(frames.at(-1)!.at);
  const caller = frames[first + 1];
  const own = `${frames[first]!.name}@${short(frames[first]!.at)}`;
  return caller === undefined ? own : `${own} < ${caller.name}@${short(caller.at)}`;
};

const tally = (keys: readonly string[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, top);
};

const print = (title: string, entries: readonly (readonly [string, number | string])[]): void => {
  console.log(`\n## ${title}`);
  for (const [key, value] of entries) console.log(`${value}\t${key}`);
};

console.log(`git ${rows.length} in ${new Set(rows.map((row) => row.file)).size} files`);
print('by file', tally(rows.map((row) => row.file)));
print('by verb', tally(rows.map((row) => row.verb)));
print('by verb and call site', tally(rows.map((row) => `${row.verb}\t${siteOf(row)}`)));

const roots = new Map<string, Row[]>();
for (const row of rows) {
  if (row.root === null) continue;
  const key = `${row.file}\0${row.root.id}`;
  roots.set(key, [...(roots.get(key) ?? []), row]);
}
const operations = new Map<string, { instances: number; spawns: number; repeats: number }>();
const repeated: string[] = [];
for (const list of roots.values()) {
  const name = list[0]!.root!.name;
  const operation = operations.get(name) ?? { instances: 0, spawns: 0, repeats: 0 };
  operation.instances += 1;
  operation.spawns += list.length;
  const seen = new Set<string>();
  for (const row of list) {
    const command = JSON.stringify([row.cwd, row.argv]);
    if (!seen.has(command)) seen.add(command);
    else {
      operation.repeats += 1;
      repeated.push(`${row.verb}\t${siteOf(row)}`);
    }
  }
  operations.set(name, operation);
}
print(
  'root operations: git, instances, git per instance, repeats',
  [...operations]
    .sort((left, right) => right[1].spawns - left[1].spawns)
    .slice(0, top)
    .map(([name, op]) => [`${op.instances}\t${(op.spawns / op.instances).toFixed(1)}\t${op.repeats}\t${name}`, op.spawns] as const),
);
print(`same argv and cwd repeated inside one root (candidates, read each site): ${repeated.length}`, tally(repeated));
