import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { DeclaredPart, ListenerReport, LoadInterest, LoadReading, ProcessReport } from './protocol/evidence';
import type { ExecutionRef } from './protocol/execution';
import type { ForegroundAnswer } from './protocol/terminal';
import type { ExecutionsFailure } from './Executions';

export type LoadSubscription = {
  readonly readings: Stream.Stream<LoadReading, ExecutionsFailure>;
  readonly setInterest: (interest: LoadInterest) => Effect.Effect<void, ExecutionsFailure>;
  readonly setParts: (parts: ReadonlyArray<DeclaredPart>) => Effect.Effect<void, ExecutionsFailure>;
};

export class ExecutionEvidence extends Context.Service<
  ExecutionEvidence,
  {
    readonly processes: (execution: ExecutionRef) => Effect.Effect<ProcessReport | undefined, ExecutionsFailure>;
    readonly foreground: (execution: ExecutionRef) => Effect.Effect<ForegroundAnswer, ExecutionsFailure>;
    readonly listeners: (execution: ExecutionRef) => Effect.Effect<ListenerReport | undefined, ExecutionsFailure>;
    readonly hostListeners: () => Effect.Effect<ListenerReport, ExecutionsFailure>;
    readonly load: (
      serverPid: number,
      parts: ReadonlyArray<DeclaredPart>,
    ) => Effect.Effect<LoadSubscription, ExecutionsFailure, Scope.Scope>;
  }
>()('@runlith/executions/ExecutionEvidence') {}
