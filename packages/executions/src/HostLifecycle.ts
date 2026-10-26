import { Context, type Effect } from 'effect';
import type { CapabilityProfile } from './protocol/capacity';
import type { Served } from './protocol/capability';
import type { ExecutionRef, Incarnation, HostRequestRef } from './protocol/execution';
import type { DisownReport, Disowned } from './protocol/keep';
import type { Pace, PaceReport } from './protocol/pace';
import type { PrepareAnswer, QuiescenceAnswer, QuiescenceTicket, ResumeAnswer, RuntimeStatus, YieldAnswer } from './protocol/runtime';
import type { ResidualEnding, ShutdownAnswer, ProcessTarget, ProcessEnding } from './protocol/stop';
import type { ExecutionsFailure } from './Executions';

export class HostLifecycle extends Context.Service<
  HostLifecycle,
  {
    readonly status: () => Effect.Effect<RuntimeStatus, ExecutionsFailure>;
    readonly capabilities: () => Effect.Effect<CapabilityProfile, ExecutionsFailure>;
    readonly served: () => Effect.Effect<Served, ExecutionsFailure>;
    readonly generation: () => Effect.Effect<Incarnation, ExecutionsFailure>;
    readonly quiesce: (operation: HostRequestRef) => Effect.Effect<QuiescenceAnswer, ExecutionsFailure>;
    readonly resume: (ticket: QuiescenceTicket) => Effect.Effect<ResumeAnswer, ExecutionsFailure>;
    readonly prepare: (operation: HostRequestRef) => Effect.Effect<PrepareAnswer, ExecutionsFailure>;
    readonly yield: (ticket: QuiescenceTicket) => Effect.Effect<YieldAnswer, ExecutionsFailure>;
    readonly shutdown: (operation: HostRequestRef) => Effect.Effect<ShutdownAnswer, ExecutionsFailure>;
    readonly pace: (pace: Pace) => Effect.Effect<PaceReport, ExecutionsFailure>;
    readonly disown: (disowned: Disowned) => Effect.Effect<DisownReport, ExecutionsFailure>;
    readonly endProcess: (target: ProcessTarget) => Effect.Effect<ProcessEnding, ExecutionsFailure>;
    readonly endResidual: (origin: ExecutionRef, pid: number) => Effect.Effect<ResidualEnding, ExecutionsFailure>;
  }
>()('@runlith/executions/HostLifecycle') {}
