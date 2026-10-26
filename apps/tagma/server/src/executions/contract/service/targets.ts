import { Context, type Effect, type Scope } from 'effect';
import type {
  EnvironmentBinding,
  EnvironmentCapability,
  EnvironmentConsumer,
  EnvironmentKind,
  EnvironmentVerdictFailure,
} from '../../../workspace/contract/wire/environments.js';
import type { ProjectRootFailure } from '../../../workspace/contract/wire/coverage.js';
import type { RootBinding } from '../../../workspace/contract/wire/roots.js';
import type { AcquiredEnvironment } from '../../../workspace/contract/service/environments.js';
import type { AdmittedExecutionTarget, ResolvedExecutionTarget } from '../wire/targets.js';
import type { TerminalRefused, TerminalUnavailable } from '../wire/refusals.js';

export type ExecutionTargetFailure = EnvironmentVerdictFailure | ProjectRootFailure | TerminalRefused | TerminalUnavailable;

export type TargetRequest = {
  readonly projectId: number;
  readonly kind: EnvironmentKind;
  readonly cwd: string;
  readonly binding?: EnvironmentBinding;
  readonly root?: RootBinding;
};

export type AcquiredExecutionTarget = {
  readonly admitted: AdmittedExecutionTarget;
  readonly acquired: AcquiredEnvironment;
};

export type TargetScope = {
  readonly resolve: (request: TargetRequest) => Effect.Effect<ResolvedExecutionTarget, ExecutionTargetFailure>;
};

export class TerminalTargets extends Context.Service<
  TerminalTargets,
  {
    readonly scope: () => TargetScope;
    readonly resolve: (request: TargetRequest) => Effect.Effect<ResolvedExecutionTarget, ExecutionTargetFailure>;
    readonly acquire: (
      target: ResolvedExecutionTarget,
      consumer: EnvironmentConsumer,
      requires: readonly EnvironmentCapability[],
    ) => Effect.Effect<AcquiredExecutionTarget, ExecutionTargetFailure, Scope.Scope>;
    readonly readmit: (held: AcquiredExecutionTarget) => Effect.Effect<AcquiredExecutionTarget, ExecutionTargetFailure>;
  }
>()('tagma/executions/TerminalTargets') {}
