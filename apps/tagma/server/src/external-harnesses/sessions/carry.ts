import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';

export type Carrying = {
  readonly adapter: HarnessAdapter;
  readonly provider: string;
  readonly from: string;
  readonly into: string;
  readonly root: string;
  readonly replaced: string | null;
};

export type Carried = { readonly _tag: 'Carried' } | { readonly _tag: 'Refused'; readonly reason: string };

export type SessionCarrying = (carrying: Carrying) => Effect.Effect<Carried, HarnessFailure>;

const CARRIED: Carried = { _tag: 'Carried' };

const refused = (reason: string): Carried => ({ _tag: 'Refused', reason });

export const makeSessionCarrying = (accounts: HarnessAccounts['Service'], files: FileSystem.FileSystem): SessionCarrying =>
  Effect.fn('SessionCarrying.carry')(
    function* ({ adapter, provider, from, into, root, replaced }: Carrying) {
      const carry = adapter.launch?.carry;
      if (carry === undefined) return refused(`${adapter.harness} declares no session folder to carry`);
      const home = (account: string) =>
        Effect.map(accounts.launch(provider, account), (launch) => launch?.directory ?? join(homedir(), carry.folder));
      const source = yield* home(from);
      const target = yield* home(into);
      if (source === target) return CARRIED;
      const paths = yield* carry.session(files, source, root);
      if (paths.length === 0) return refused(`no session ${root} stands in ${source}`);
      const kept = replaced === null || replaced === root ? [] : yield* carry.session(files, source, replaced);
      for (const path of [...paths, ...kept]) {
        yield* files.makeDirectory(dirname(join(target, path)), { recursive: true });
        yield* files.copy(join(source, path), join(target, path), { overwrite: true });
      }
      return CARRIED;
    },
    (effect) =>
      effect.pipe(
        Effect.catchTags({
          GateRefusal: (refusal) => Effect.succeed(refused(refusal.message)),
          PlatformError: (failure) => Effect.succeed(refused(failure.message)),
        }),
        Effect.mapError(threadCallFailed),
      ),
  );
