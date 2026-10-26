import { Context, type Effect } from 'effect';
import type { IntakeRefused, Landed } from '@runlith/agent-tools/WorkspaceChanges';
import type { ChangeTarget, WorkspaceChange } from '@runlith/files/change';
import type { Holder } from '../../../workspace/contract/wire/checkout.js';

export type IntakeFact = WorkspaceChange & { readonly reverts?: readonly string[]; readonly key?: string };

export type IntakeWork = { readonly projectId: number; readonly holder: Holder };

export class Intake extends Context.Service<
  Intake,
  {
    turn<A, E, R>(
      projectId: number,
      paths: readonly string[],
      work: Effect.Effect<A, E, R>,
      target?: ChangeTarget,
    ): Effect.Effect<A, E | IntakeRefused, R>;
    land<E, R>(
      work: IntakeWork,
      facts: readonly IntakeFact[],
      write: Effect.Effect<boolean, E, R>,
    ): Effect.Effect<Landed, E | IntakeRefused, R>;
  }
>()('tagma/change-record/Intake') {}
