import { readFileSync } from 'node:fs';

type Node = {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly children?: number[];
};
type Profile = {
  readonly nodes: readonly Node[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
  readonly marks: { readonly profiled: number; readonly import: number; readonly built: number };
};

const file = process.argv[2];
if (file === undefined) throw new Error('usage: bun scripts/profile-shares.ts <profile written by profile-runtime.ts --profile>');
const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile;
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map<number, number>();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const stackOf = (id: number): Node[] => {
  const stack: Node[] = [];
  for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
    const node = nodes.get(at);
    if (node !== undefined) stack.push(node);
  }
  return stack;
};
const short = (url: string) =>
  url
    .replace(/.*\/runlith\//, '')
    .replace(/node_modules\/\.bun\/[^/]+\/node_modules\//, 'nm:')
    .replace(/^apps\/tagma\/server\/src\//, 'src/');
const positive = profile.timeDeltas.filter((delta) => delta > 0).toSorted((a, b) => a - b);
const period = positive[Math.floor(positive.length / 4)] ?? 1;
const kinds: readonly (readonly [string, (stack: readonly Node[]) => boolean])[] = [
  ['migrations', (stack) => stack.some((node) => /migrat/i.test(`${node.callFrame.functionName} ${node.callFrame.url}`))],
  ['sqlite ipc', (stack) => stack.some((node) => node.callFrame.url.includes('packages/sqlite-process'))],
  ['telemetry', (stack) => stack.some((node) => node.callFrame.url.includes('packages/performance'))],
  ['gc', (stack) => stack[0]?.callFrame.functionName === '(garbage collector)'],
];
const windows = ['import', 'build', 'idle'] as const;
const shares = new Map(windows.map((window) => [window, { kinds: new Map<string, number>(), owners: new Map<string, number>() }]));
let elapsed = profile.marks.profiled;
profile.samples.forEach((sample, index) => {
  const delta = profile.timeDeltas[index] ?? 0;
  elapsed += delta / 1000;
  const stack = stackOf(sample);
  const leaf = stack[0];
  if (leaf === undefined || leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') return;
  const window = elapsed < profile.marks.import ? 'import' : elapsed < profile.marks.built ? 'build' : 'idle';
  const ms = Math.min(delta, period) / 1000;
  const into = shares.get(window);
  if (into === undefined) return;
  const kind = kinds.find(([, test]) => test(stack))?.[0] ?? 'other';
  into.kinds.set(kind, (into.kinds.get(kind) ?? 0) + ms);
  const owned = stack.find((node) => /apps\/tagma\/server\/src\/|packages\/[^/]+\/src\//.test(node.callFrame.url));
  const owner =
    owned === undefined
      ? short(leaf.callFrame.url || leaf.callFrame.functionName)
      : short(owned.callFrame.url).split('/').slice(0, 2).join('/');
  into.owners.set(owner, (into.owners.get(owner) ?? 0) + ms);
});
const top = (map: ReadonlyMap<string, number>, count: number) =>
  [...map]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${key}`)
    .join('\n');
console.log(`sampling period ${period} us; sampled main-thread time per window, weighted by at most one period per sample`);
for (const [window, { kinds: seen, owners }] of shares) {
  console.log(`\n== ${window}\n${top(seen, 8)}\n-- owners\n${top(owners, 18)}`);
}
