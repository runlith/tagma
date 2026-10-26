import { Context, Data, type Effect, type Scope } from 'effect';
import type { World } from '@runlith/agent-tools/world';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type {
  EnvironmentBinding,
  EnvironmentConsumer,
  EnvironmentIdentity,
  EnvironmentKind,
  EnvironmentInput,
  EnvironmentState,
  EnvironmentUse,
  EnvironmentUseEvidence,
  EnvironmentUseId,
  EnvironmentUseReceipt,
  EnvironmentVerdictFailure,
} from '../wire/environments.js';

export class EnvironmentOpenRefused extends Data.TaggedError('EnvironmentOpenRefused')<{
  readonly binding: EnvironmentBinding;
  readonly reason: string;
}> {
  override get message(): string {
    return `environment-open-refused: ${this.binding.environmentId} — ${this.reason}`;
  }
}

export class EnvironmentOpenLost extends Data.TaggedError('EnvironmentOpenLost')<{
  readonly binding: EnvironmentBinding;
  readonly reason: string;
}> {
  override get message(): string {
    return `environment-open-lost: ${this.binding.environmentId} — ${this.reason}`;
  }
}

export type EnvironmentResources = {
  readonly world: World;
  readonly commandEnvironment: CommandEnvironment;
};

export type EnvironmentHold =
  | { readonly _tag: 'Intrinsic' }
  | {
      readonly _tag: 'Retained';
      readonly admit: (unit: WriteUnit<'machine'>, binding: EnvironmentBinding) => Effect.Effect<void, EnvironmentVerdictFailure>;
    };

export type EnvironmentBackend = {
  readonly kind: EnvironmentKind;
  readonly hold: EnvironmentHold;
  state(identity?: EnvironmentIdentity): Effect.Effect<EnvironmentState, EnvironmentVerdictFailure>;
  open(binding: EnvironmentBinding): Effect.Effect<EnvironmentResources, EnvironmentOpenRefused | EnvironmentOpenLost, Scope.Scope>;
  activate(binding: EnvironmentBinding): Effect.Effect<EnvironmentState, EnvironmentVerdictFailure>;
};

export class EnvironmentBackends extends Context.Service<
  EnvironmentBackends,
  { bound(kind: EnvironmentKind): EnvironmentBackend | null }
>()('tagma/workspace/EnvironmentBackends') {}

export type AcquiredEnvironment = {
  readonly binding: EnvironmentBinding;
  readonly accessGeneration: number;
  readonly world: World;
  readonly commandEnvironment: CommandEnvironment;
  readonly use: EnvironmentUseReceipt;
};

export class Environments extends Context.Service<
  Environments,
  {
    inspect(
      kind: EnvironmentKind,
      options?: { readonly binding?: EnvironmentBinding },
    ): Effect.Effect<EnvironmentState, EnvironmentVerdictFailure>;
    acquireActive(request: EnvironmentInput): Effect.Effect<AcquiredEnvironment, EnvironmentVerdictFailure, Scope.Scope>;
    activate(binding: EnvironmentBinding): Effect.Effect<EnvironmentState, EnvironmentVerdictFailure>;
    release(
      unit: WriteUnit<'machine'>,
      useId: EnvironmentUseId,
      consumer: EnvironmentConsumer,
      evidence: EnvironmentUseEvidence,
    ): Effect.Effect<EnvironmentUse, EnvironmentVerdictFailure>;
    releaseUse(
      useId: EnvironmentUseId,
      consumer: EnvironmentConsumer,
      evidence: EnvironmentUseEvidence,
    ): Effect.Effect<EnvironmentUse, EnvironmentVerdictFailure>;
    heldUses(consumer: EnvironmentConsumer): Effect.Effect<readonly EnvironmentUse[], EnvironmentVerdictFailure>;
  }
>()('tagma/workspace/Environments') {}
