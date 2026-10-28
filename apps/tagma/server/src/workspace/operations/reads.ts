import { Effect } from 'effect';
import {
  CheckoutHistory,
  CheckoutHoldings,
  CheckoutPlaces,
  CheckoutRows,
  CommitOverlay,
  type CheckoutCaller,
} from '../contract/service/checkouts.js';
import { rowHolders } from '../checkouts/holders.js';
import { CoveredRepositories } from '../contract/service/repositories.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { projectRootRefusal } from '../roots/refusal.js';
import { WORKING_OPERATIONS } from '../contract/wire/repositoryReads.js';

export const readRepositories = Effect.fn('reads.repositories')(function* (projectId: number, input: { readonly path?: string }) {
  const stores = yield* CoveredRepositories;
  return yield* input.path === undefined ? stores.list(projectId) : stores.at(projectId, input.path);
});

export const REPOSITORY_PAIRS = {
  read_repositories: pair(
    WORKING_OPERATIONS.read_repositories,
    body(WORKING_OPERATIONS.read_repositories, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* yield* CurrentProject;
        const covered = yield* admitted(WORKING_OPERATIONS.read_repositories)(
          Effect.mapError(readRepositories(project.project.id, { path: input.path }), projectRootRefusal),
        );
        return { status: 'ok' as const, ...covered };
      }),
    }),
  ),
  locate_commits: pair(
    WORKING_OPERATIONS.locate_commits,
    body(WORKING_OPERATIONS.locate_commits, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* yield* CurrentProject;
        const located = yield* (yield* CoveredRepositories).commits(input.commits, project.project.id);
        return { status: 'ok' as const, ...located };
      }),
    }),
  ),
};

export const readCheckout = Effect.fn('reads.checkout')(function* (
  caller: CheckoutCaller,
  input: { readonly root?: string; readonly base?: string },
) {
  const rootId = yield* (yield* CheckoutPlaces).rootOf(caller, input.root);
  const row = yield* Effect.mapError((yield* CheckoutRows).read(rootId, input.base), projectRootRefusal);
  const holders = yield* Effect.mapError(rowHolders(row, yield* CheckoutHoldings), (failure) =>
    failure._tag === 'EffectDrizzleQueryError' || failure._tag === 'SqlError' ? failure : projectRootRefusal(failure),
  );
  return { row, holders };
});

export const readCheckoutHistory = Effect.fn('reads.history')(function* (
  caller: CheckoutCaller,
  input: {
    readonly root?: string;
    readonly path?: string;
    readonly grep?: string;
    readonly limit?: number;
    readonly cursor?: string;
  },
  graphAuthors: ReadonlySet<string>,
) {
  const checkouts = yield* CheckoutHistory;
  return yield* checkouts.history(
    caller,
    { root: input.root, path: input.path, grep: input.grep, limit: input.limit, cursor: input.cursor },
    graphAuthors,
  );
});

export const readCommit = Effect.fn('reads.commit')(function* (
  caller: CheckoutCaller,
  input: {
    readonly root?: string;
    readonly commit: string;
    readonly thread?: string;
    readonly limit?: number;
    readonly cursor?: string;
  },
  overlay?: CommitOverlay['Service'],
) {
  const checkouts = yield* CheckoutHistory;
  return yield* checkouts.commit(
    caller,
    { root: input.root, commit: input.commit, thread: input.thread, limit: input.limit, cursor: input.cursor },
    overlay,
  );
});
