import { Effect } from 'effect';
import { BlockTreeUnreadable } from './layout.js';
import { askOnce } from './oneShot.js';

export type Validation =
  | { readonly state: 'valid' }
  | { readonly state: 'invalid'; readonly reason: BlockTreeUnreadable['reason']; readonly path: string; readonly message: string };

export const validateTree = (treeRoot: string): Effect.Effect<void, BlockTreeUnreadable> =>
  askOnce<Validation, BlockTreeUnreadable>(
    new URL('./validation.worker.ts', import.meta.url),
    treeRoot,
    (message) => new BlockTreeUnreadable({ reason: 'io', path: treeRoot, message }),
  ).pipe(
    Effect.flatMap((answer) =>
      answer.state === 'valid'
        ? Effect.void
        : Effect.fail(new BlockTreeUnreadable({ reason: answer.reason, path: answer.path, message: answer.message })),
    ),
  );
