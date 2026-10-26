import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Node = {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly children?: readonly number[];
};
type Profile = { readonly nodes: readonly Node[]; readonly samples: readonly number[] };

const args = process.argv.slice(2);
const underAt = args.indexOf('--under');
const under = underAt === -1 ? undefined : args[underAt + 1];
const file = args.find((_, at) => underAt === -1 || (at !== underAt && at !== underAt + 1));
if (file === undefined || (underAt !== -1 && under === undefined)) {
  console.error('usage: bun profile-report.ts <file.cpuprofile> [--under <url part>]');
  process.exit(2);
}

const REPO = resolve(import.meta.dir, '../../../..');

const local = (url: string): string => {
  const path = url.startsWith('file://') ? fileURLToPath(url) : url;
  return path.startsWith(`${REPO}/`) ? path.slice(REPO.length + 1) : url;
};

const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile;
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map<number, number>();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);

const samples = profile.samples.filter((id) => nodes.get(id)?.callFrame.functionName !== '(idle)');
const total = samples.length;

const place = (node: Node): string => {
  const { url, functionName } = node.callFrame;
  if (url === '') return functionName.startsWith('(') ? functionName : '(native)';
  const dependency = /node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(url);
  if (dependency !== null) return `npm ${dependency[1]}`;
  const pkg = /packages\/([^/]+)\/src\/([^/]+)/.exec(url);
  if (pkg !== null) return `packages/${pkg[1]}/${pkg[2]}`;
  const server = /apps\/tagma\/server\/src\/([^/]+)/.exec(url);
  if (server !== null) return `server ${server[1]}`;
  return local(url);
};

const share = (count: number): string => `${((100 * count) / Math.max(total, 1)).toFixed(1).padStart(5)}%`;

const tally = (keys: readonly string[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 30);
};

console.log(`${total} busy samples, idle left out; shares are of these`);
console.log('\n## self by place');
for (const [key, count] of tally(samples.map((id) => place(nodes.get(id)!)))) console.log(share(count), count, key);
console.log('\n## self by function');
const fn = (node: Node): string =>
  `${node.callFrame.functionName || '(anonymous)'} ${local(node.callFrame.url)}:${node.callFrame.lineNumber + 1}`;
for (const [key, count] of tally(samples.map((id) => fn(nodes.get(id)!)))) console.log(share(count), count, key);

if (under !== undefined) {
  const below = samples.filter((id) => {
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) if (nodes.get(at)!.callFrame.url.includes(under)) return true;
    return false;
  });
  const own = below.filter((id) => nodes.get(id)!.callFrame.url.includes(under));
  console.log(`\n## under ${under}`);
  console.log(`${share(below.length)} inclusive: samples with a frame of it on the stack`);
  console.log(`${share(own.length)} self: samples executing its own code`);
  console.log('the rest ran elsewhere while one of its frames stood below, such as code a callback of it resumed:');
  for (const [key, count] of tally(below.filter((id) => !nodes.get(id)!.callFrame.url.includes(under)).map((id) => place(nodes.get(id)!))).slice(0, 10))
    console.log(share(count), count, key);
}
