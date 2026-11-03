import { Context, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ActorRef } from '../../../platform/contract/wire/actor.js';
import type { Reshaped } from '../wire/reshape.js';
import type { ShapeRefusal } from '../wire/shape.js';
import type { DeriveCommand } from '../wire/derivation.js';

export type DerivationNeed = { readonly paths: readonly string[] };

export type ShapeAct = ActorRef;

export type ShapeAsk = {
  readonly projectId: number;
  readonly git: Git['Service'];
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly act: ShapeAct;
  readonly base: string;
  readonly tree: string;
  readonly job: string;
  readonly skipping: boolean;
  readonly merging?: boolean;
  readonly derive?: readonly DeriveCommand[];
  readonly derivation?: (declared: boolean) => Effect.Effect<DerivationNeed | undefined, OwnGitFailed>;
};

export type Shaped = {
  readonly tree: string;
  readonly reshaped: readonly Reshaped[];
  readonly skipped: boolean;
  readonly declaration: readonly string[];
  readonly derived?: readonly string[];
};

export class CommitShape extends Context.Service<
  CommitShape,
  {
    shape(ask: ShapeAsk): Effect.Effect<Shaped, OwnGitFailed | GateRefusal<ShapeRefusal | 'landing-busy'>>;
  }
>()('tagma/change-record/CommitShape') {}

export const UNSHAPED: CommitShape['Service'] = {
  shape: (ask) => Effect.succeed({ tree: ask.tree, reshaped: [], skipped: false, declaration: [] }),
};
