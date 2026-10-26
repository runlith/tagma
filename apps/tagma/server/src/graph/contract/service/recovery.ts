import { Context, type Effect, type Stream } from 'effect';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphRecovery, RecoveryAim, RecoveryNotice } from '../wire/recovery.js';

export type RecoveryRefusal = OpenRefusal | 'team-tree';

export class GraphRecoveries extends Context.Service<
  GraphRecoveries,
  {
    read(aim: RecoveryAim): Effect.Effect<GraphRecovery | null, GateRefusal<RecoveryRefusal>>;
    follow(projectId: number): Stream.Stream<RecoveryNotice, GateRefusal<RecoveryRefusal>>;
    assign<E, R>(
      aim: RecoveryAim,
      id: string,
      create: (recovery: GraphRecovery) => Effect.Effect<string, E, R>,
    ): Effect.Effect<string, E | GateRefusal<RecoveryRefusal>, R>;
    finish(
      aim: RecoveryAim,
      author: string,
    ): Effect.Effect<
      { readonly commit: string | null; readonly resolved: readonly string[]; readonly remaining?: readonly string[] },
      GateRefusal<RecoveryRefusal | 'no-merge' | 'files'>
    >;
  }
>()('graph/GraphRecoveries') {}
