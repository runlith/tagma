import { availableParallelism } from 'node:os';
import { Effect } from 'effect';
import { workerLink } from '@runlith/utils/worker';

export type Owner = { readonly path: string; readonly line: number; readonly name: string };

export type Owners = {
  readonly found: readonly Owner[];
  readonly imported: readonly (readonly Owner[])[];
  readonly unparsed: readonly string[];
};

export type Import = Owner & { readonly source: string };

export type OwnersAsk = { readonly id: number; readonly root: string; readonly name: string; readonly paths: readonly string[] };

export type OwnersAnswer = {
  readonly id: number;
  readonly found: readonly Owner[];
  readonly imports: readonly Import[];
  readonly unparsed: readonly string[];
};

const MOST_LANES = 3;

const LANES = Math.max(1, Math.min(MOST_LANES, availableParallelism() - 1));

const lanes = Array.from({ length: LANES }, () =>
  workerLink<OwnersAsk, OwnersAnswer>(
    'navigation owners worker',
    () => new Worker(new URL('./owners.worker.ts', import.meta.url), { type: 'module' }),
  ),
);

const byPlace = (left: Owner, right: Owner): number =>
  left.path === right.path ? left.line - right.line : left.path < right.path ? -1 : 1;

const shardOf = (paths: readonly string[]): (readonly string[])[] => {
  const shards: string[][] = lanes.map(() => []);
  for (const path of paths) shards[Number(BigInt(Bun.hash(path)) % BigInt(LANES))]?.push(path);
  return shards;
};

export const findOwners = Effect.fn('navigation.owners')(function* (root: string, name: string, paths: readonly string[]) {
  const shards = shardOf(paths);
  const answers = yield* Effect.forEach(
    lanes.flatMap((lane, at) => (shards[at]?.length ? [{ lane, paths: shards[at] }] : [])),
    ({ lane, paths: shard }) => lane.ask((id) => ({ id, root, name, paths: shard })),
    { concurrency: LANES },
  );
  const sources = new Map<string, Owner[]>();
  for (const { source, ...one } of answers.flatMap((answer) => answer.imports).sort(byPlace)) {
    const held = sources.get(source);
    if (held === undefined) sources.set(source, [one]);
    else held.push(one);
  }
  return {
    found: answers.flatMap((answer) => answer.found).sort(byPlace),
    imported: [...sources.values()],
    unparsed: answers.flatMap((answer) => answer.unparsed).sort(),
  } satisfies Owners;
});
