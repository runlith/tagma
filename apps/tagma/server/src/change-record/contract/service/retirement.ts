import { Context, Data, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { HoldingsFailure } from './holdings.js';

export type LandingTree = {
  readonly checkout: RootId;
  readonly commit: string;
  readonly tree: string;
};

export type Retired = { readonly committed: readonly string[]; readonly withdrawn: readonly string[] };

export class RetireUnwritten extends Data.TaggedError('RetireUnwritten')<{ readonly path: string; readonly reason: string }> {
  override get message(): string {
    return `the commit's form could not be written into ${this.path}: ${this.reason}`;
  }
}

export type RetireFailure = StoreFailure | OwnGitFailed | HoldingsFailure | RetireUnwritten;

export class Retirement extends Context.Service<
  Retirement,
  {
    landing(fact: LandingTree): Effect.Effect<void, StoreFailure>;
    pass(checkout: RootId): Effect.Effect<Retired, RetireFailure>;
    lease<A, E, R>(checkout: RootId, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
    formed(checkout: RootId, ids: readonly string[]): Effect.Effect<Retired, StoreFailure>;
    settle(checkout: RootId): Effect.Effect<number, RetireFailure>;
    gone(checkout: RootId): Effect.Effect<Retired, StoreFailure>;
  }
>()('tagma/change-record/Retirement') {}
