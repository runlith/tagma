import { readdirSync } from 'node:fs';
import { Effect } from 'effect';
import { BlockTreeUnreadable, type ScannedBlock, readBlockTree } from './layout.js';
import { askOnce } from './oneShot.js';

export type TreeRef = {
  readonly fromId: string;
  readonly to: string;
};

export type TreeScan = {
  readonly blocks: readonly ScannedBlock[];
  readonly refs: readonly TreeRef[];
};

export type ScanJob = { readonly root: string; readonly whole: boolean };

export type ScanAnswer =
  | { readonly state: 'scanned'; readonly scan: TreeScan }
  | { readonly state: 'holds'; readonly holds: boolean }
  | { readonly state: 'failed'; readonly reason: BlockTreeUnreadable['reason']; readonly path: string; readonly message: string };

const askScan = (job: ScanJob) =>
  askOnce<ScanAnswer, BlockTreeUnreadable>(
    new URL('./scan.worker.ts', import.meta.url),
    job,
    (message) => new BlockTreeUnreadable({ reason: 'io', path: job.root, message }),
  ).pipe(
    Effect.flatMap((answer) =>
      answer.state === 'failed'
        ? Effect.fail(new BlockTreeUnreadable({ reason: answer.reason, path: answer.path, message: answer.message }))
        : Effect.succeed(answer),
    ),
  );

const REFERENCE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

export function blockRefsOf(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(REFERENCE)) {
    const to = (match[1] as string).trim();
    if (to !== '') out.push(to);
  }
  return out;
}

export const readTreeScan = Effect.fnUntraced(function* (root: string) {
  const blocks = yield* readBlockTree(root);
  const refs: TreeRef[] = [];
  for (const block of blocks) {
    for (const to of blockRefsOf(block.body)) refs.push({ fromId: block.frontmatter.id, to });
  }
  return { blocks, refs };
});

export const scanTree = (root: string): Effect.Effect<TreeScan, BlockTreeUnreadable> =>
  askScan({ root, whole: true }).pipe(
    Effect.flatMap((answer) =>
      answer.state === 'scanned'
        ? Effect.succeed(answer.scan)
        : Effect.die(`the tree scanner answered ${answer.state} to a whole scan of ${root}`),
    ),
    Effect.withSpan('Graph.scanTree', { attributes: { root } }),
  );

const showsEntries = (root: string): Effect.Effect<boolean, BlockTreeUnreadable> =>
  Effect.try({
    try: () => readdirSync(root).some((name) => !name.startsWith('.')),
    catch: (error) =>
      new BlockTreeUnreadable({ reason: 'io', path: root, message: error instanceof Error ? error.message : String(error) }),
  });

export const treeHoldsAny = (root: string): Effect.Effect<boolean, BlockTreeUnreadable> =>
  showsEntries(root).pipe(
    Effect.flatMap((shown) => (shown ? askScan({ root, whole: false }) : Effect.succeed({ state: 'holds', holds: false } as const))),
    Effect.flatMap((answer) =>
      answer.state === 'holds'
        ? Effect.succeed(answer.holds)
        : Effect.die(`the tree scanner answered ${answer.state} to whether ${root} holds a block`),
    ),
    Effect.withSpan('Graph.treeHoldsAny', { attributes: { root } }),
  );
