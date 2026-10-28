import { readFileSync } from 'node:fs';
import { Effect } from 'effect';
import { type BlockFile, type BlockFileInvalid, decodeBlockFile } from './blockFile.js';
import { BlockTreeUnreadable, type TreeRoots, fileIn } from './layout.js';
import { askOnce } from './oneShot.js';

export type BlockRead =
  | { readonly path: string; readonly state: 'absent' }
  | { readonly path: string; readonly state: 'read'; readonly file: BlockFile }
  | { readonly path: string; readonly state: 'invalid'; readonly reason: BlockFileInvalid['reason']; readonly message: string };

export type BlockReadsJob = { readonly treeRoot: string; readonly stealth: string | null; readonly paths: readonly string[] };

export type BlockReadsAnswer =
  | { readonly state: 'read'; readonly reads: readonly BlockRead[] }
  | { readonly state: 'failed'; readonly path: string; readonly message: string };

const ON_LOOP = 32;

const textAt = (abs: string): string | null => {
  try {
    return readFileSync(abs, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new BlockTreeUnreadable({ reason: 'io', path: abs, message: error instanceof Error ? error.message : String(error) });
  }
};

export const blockReadsOf = (job: BlockReadsJob): readonly BlockRead[] =>
  job.paths.map((path): BlockRead => {
    const text = textAt(fileIn({ root: job.treeRoot, stealth: job.stealth }, path));
    if (text === null) return { path, state: 'absent' };
    const decoded = Effect.runSync(Effect.result(decodeBlockFile(text)));
    return decoded._tag === 'Success'
      ? { path, state: 'read', file: decoded.success }
      : { path, state: 'invalid', reason: decoded.failure.reason, message: decoded.failure.message };
  });

const onLoop = (job: BlockReadsJob): Effect.Effect<readonly BlockRead[], BlockTreeUnreadable> =>
  Effect.try({
    try: () => blockReadsOf(job),
    catch: (error) =>
      error instanceof BlockTreeUnreadable
        ? error
        : new BlockTreeUnreadable({ reason: 'io', path: job.treeRoot, message: error instanceof Error ? error.message : String(error) }),
  });

const inWorker = (job: BlockReadsJob): Effect.Effect<readonly BlockRead[], BlockTreeUnreadable> =>
  askOnce<BlockReadsAnswer, BlockTreeUnreadable>(
    new URL('./blockReads.worker.ts', import.meta.url),
    job,
    (message) => new BlockTreeUnreadable({ reason: 'io', path: job.treeRoot, message }),
  ).pipe(
    Effect.flatMap((answer) =>
      answer.state === 'read'
        ? Effect.succeed(answer.reads)
        : Effect.fail(new BlockTreeUnreadable({ reason: 'io', path: answer.path, message: answer.message })),
    ),
  );

export const readBlocks = Effect.fn('Graph.readBlocks')(function* (roots: TreeRoots, paths: readonly string[]) {
  if (paths.length === 0) return [];
  yield* Effect.annotateCurrentSpan({ paths: paths.length });
  return yield* (paths.length <= ON_LOOP ? onLoop : inWorker)({ treeRoot: roots.root, stealth: roots.stealth, paths });
});
