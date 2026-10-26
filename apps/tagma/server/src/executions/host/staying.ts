import { Effect, type FileSystem } from 'effect';
import { stateClaim, type StateClaim } from './boot.js';
import { executionStates } from './connection.js';

export type HostStaying = { readonly state: string; readonly claim: Exclude<StateClaim, { readonly _tag: 'Free' }> };

const ASKED_EVERY = '100 millis';

export const hostsStaying = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  storePath: string,
): Effect.fn.Return<readonly HostStaying[]> {
  const root = executionStates(storePath);
  const listed = yield* Effect.result(files.readDirectory(root));
  if (listed._tag === 'Failure') {
    return listed.failure.reason._tag === 'NotFound'
      ? []
      : [{ state: root, claim: { _tag: 'Unmeasured', detail: `${root} could not be read: ${listed.failure.reason._tag}` } }];
  }
  const staying: HostStaying[] = [];
  for (const name of listed.success) {
    const state = `${root}/${name}`;
    for (;;) {
      const claim = yield* stateClaim(files, state);
      if (claim._tag === 'Free') break;
      if (claim._tag === 'Unmeasured') {
        staying.push({ state, claim });
        break;
      }
      yield* Effect.sleep(ASKED_EVERY);
    }
  }
  return staying;
});
