import { Effect, Result } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import type { DoctrineFact } from '../platform/contract/wire/section.js';
import { actingGit, readingFailed } from '../platform/git/ownGit.js';
import { CONFIG_FILE } from './contract/wire/config.js';
import { headOf } from './head.js';
import { blobsAt } from './version.js';

const KEPT = 256;

const known = new Map<string, { readonly head: string; readonly present: boolean }>();

const remember = (root: string, head: string, present: boolean): void => {
  known.delete(root);
  known.set(root, { head, present });
  for (const oldest of known.keys()) {
    if (known.size <= KEPT) break;
    known.delete(oldest);
  }
};

const presentAt = Effect.fnUntraced(function* (git: Git['Service'], root: string) {
  const head = yield* commitOf(actingGit(git, 'config-head'), root, 'HEAD').pipe(
    Effect.mapError((failure) => readingFailed('config-head', failure)),
  );
  if (head === null) return false;
  return ((yield* blobsAt(git, root, head, [CONFIG_FILE])).get(CONFIG_FILE) ?? null) !== null;
});

export const configPresent: DoctrineFact['read'] = Effect.fn('Configs.present')(function* ({ root }) {
  const head = (yield* Effect.promise(() => headOf(root))) ?? '?';
  const held = known.get(root);
  if (held !== undefined && held.head === head) return held.present;
  const read = yield* Effect.result(presentAt(yield* Git, root));
  if (Result.isFailure(read)) {
    yield* Effect.logWarning(
      'whether a checkout holds tagma.config.ts at HEAD could not be read for its prompt, which then goes without the sections it conditions',
      {
        root,
        reason: String(read.failure),
      },
    );
    return false;
  }
  remember(root, head, read.success);
  return read.success;
});
