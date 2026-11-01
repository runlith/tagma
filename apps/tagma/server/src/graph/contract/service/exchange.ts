import { Context, Effect, type Scope } from 'effect';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';

export type Birth = (draft: string) => Effect.Effect<boolean, OwnGitFailed>;

export type GraphSide = {
  readonly birth: Birth | null;
  readonly tracking: string | null;
};

export const NO_SIDE: GraphSide = { birth: null, tracking: null };

export type TrackedSides = {
  readonly local: ReadonlyMap<string, string>;
  readonly tracked: ReadonlyMap<string, string>;
};

export type Exchange = {
  readonly side: (projectId: number) => GraphSide;
  readonly opened: (projectId: number, gitDir: string) => void;
  readonly committed: (projectId: number) => void;
};

type Replaced<A> = { readonly value: A; readonly aside: string };

export type ExchangeHost = {
  readonly gitDir: (projectId: number) => Effect.Effect<string, GateRefusal<'not-found' | OpenRefusal>>;
  readonly follow: (gitDir: string, sides: TrackedSides) => Effect.Effect<boolean, OwnGitFailed | GateRefusal<OpenRefusal>>;
  readonly moved: (gitDir: string) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly open: (projectId: number) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly replace: <A, E>(
    projectId: number,
    between: Effect.Effect<A, E>,
  ) => Effect.Effect<Replaced<A>, E | GateRefusal<OpenRefusal | 'graph-pool'>>;
};

const NO_EXCHANGE: Exchange = { side: () => NO_SIDE, opened: () => undefined, committed: () => undefined };

export const GraphExchange = Context.Reference<(host: ExchangeHost) => Effect.Effect<Exchange, never, Scope.Scope>>('graph/GraphExchange', {
  defaultValue: () => () => Effect.succeed(NO_EXCHANGE),
});
