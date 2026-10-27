import { Context, Effect } from 'effect';
import { CancellationCause } from '@runlith/executions/protocol/call';
import { type CustodianRefused } from '../Custodian';
import { type CustodyLost } from '../store/errors';
import {
  type EndingReading,
  type ResidualEnding,
  type SignalAnswer,
  type StopAction,
  type StopReceipt,
} from '@runlith/executions/protocol/stop';
import { ExecutionId, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { ExecutionUnknown, ExecutionUnreadable, ExecutionUnrecorded } from '../executionFailures';
import { type HostClaim, type RegistryState, commanding, live, moved } from './state';
import { ending, signal, stopOrphan, stoppedWithoutChild, sweepAfter } from './endings';
import { releaseSoon } from './retention';
import { stopQueued } from './commands';
import { endProcess } from '../ProcessEnding';
import { Processes } from '../ProcessReader';
import { ProcessControl } from '../ProcessControl';
import { sameProcess, sameScope, type LoadReading } from '@runlith/executions/protocol/evidence';
import type { ProcessTarget, ProcessEnding as ProcessOutcome } from '@runlith/executions/protocol/stop';

export class ExecutionStop extends Context.Service<
  ExecutionStop,
  {
    readonly stop: (
      claim: HostClaim,
      operation: HostRequestRef,
      execution: ExecutionId,
      cause: CancellationCause,
      action: StopAction,
      trigger?: string,
    ) => Effect.Effect<StopReceipt, ExecutionUnknown | ExecutionUnreadable | ExecutionUnrecorded | CustodianRefused | CustodyLost>;
    readonly endProcess: (
      claim: HostClaim,
      target: ProcessTarget,
      reading: LoadReading | undefined,
    ) => Effect.Effect<ProcessOutcome, CustodianRefused | CustodyLost>;
    readonly endResidual: (
      claim: HostClaim,
      origin: ExecutionRef,
      pid: number,
    ) => Effect.Effect<ResidualEnding, CustodianRefused | CustodyLost>;
    readonly signal: (
      claim: HostClaim,
      execution: ExecutionId,
      signal: string,
    ) => Effect.Effect<SignalAnswer, ExecutionUnknown | CustodianRefused | CustodyLost>;
    readonly ending: (execution: ExecutionId, remeasure?: boolean) => Effect.Effect<EndingReading | undefined, ExecutionUnreadable>;
  }
>()('@runlith/execution-host/ExecutionStop') {}

export const executionStopOf = (registry: RegistryState) => {
  const { calls, held, shelf } = registry;
  const control = Context.make(ProcessControl, registry.control);
  const native = registry.strays === undefined ? control : Context.add(control, Processes, registry.strays);
  return ExecutionStop.of({
    stop: (claim, operation, execution, cause, action, trigger) =>
      Effect.flatMap(commanding(registry, claim, 'end'), () =>
        Effect.flatMap(stopQueued(registry, operation, execution, cause, action, trigger), (given) =>
          given !== undefined
            ? Effect.succeed(given)
            : Effect.flatMap(stopOrphan(registry, operation, execution, cause, action, trigger), (orphaned) =>
                orphaned !== undefined
                  ? Effect.succeed(orphaned)
                  : !held.has(execution) && shelf.has(execution)
                    ? Effect.flatMap(stoppedWithoutChild(registry, operation, execution, cause, action), (kept) =>
                        kept === undefined ? Effect.fail(new ExecutionUnknown({ execution })) : Effect.succeed(kept),
                      )
                    : Effect.flatMap(live(registry, execution), (found) =>
                        Effect.gen(function* () {
                          yield* calls
                            .settle(found.operation, { _tag: 'Cancel', cause, trigger: trigger || `stop:${operation.operation}` })
                            .pipe(Effect.catchTag('CallMissing', () => Effect.void));
                          const receipt = yield* found.execution.stop.stop(operation, cause, action);
                          yield* sweepAfter(registry, execution, receipt);
                          yield* moved(registry, found);
                          yield* releaseSoon(registry, found);
                          return receipt;
                        }),
                      ),
              ),
        ),
      ),
    endProcess: (claim, target, reading) =>
      Effect.andThen(
        commanding(registry, claim, 'end'),
        Effect.suspend(() => {
          if (!sameScope(target.scope, registry.localScope) || (reading !== undefined && !sameScope(target.scope, reading.scope)))
            return Effect.succeed({
              _tag: 'Refused',
              target,
              reason: 'scope-mismatch',
              detail: 'the process belongs to another machine namespace',
              steps: [],
            } as const);
          const group = reading?.groups.find((one) => one.processes.some((row) => sameProcess(row.identity, target.identity)));
          const row = group?.processes.find((one) => sameProcess(one.identity, target.identity));
          if (group === undefined || row === undefined)
            return Effect.succeed({
              _tag: 'Refused',
              target,
              reason: 'not-measured',
              detail: 'this identity is not in the current machine reading',
              steps: [],
            } as const);
          if (group.owner._tag === 'Installation' || !row.signal)
            return Effect.succeed({
              _tag: 'Refused',
              target,
              reason: 'managed-process',
              detail:
                group.owner._tag === 'Installation'
                  ? "this process is Tagma's own: its server, execution host or window"
                  : 'the operating system does not let this user signal the process',
              steps: [],
            } as const);
          return endProcess({ scope: registry.localScope, target }).pipe(
            Effect.provide(native),
            Effect.updateContext((context: Context.Context<never>) => Context.omit(Processes, ProcessControl)(context)),
          );
        }),
      ),
    endResidual: (claim, origin, pid) =>
      Effect.andThen(
        commanding(registry, claim, 'end'),
        Effect.gen(function* () {
          const found = held.get(origin.execution)?.ref ?? shelf.get(origin.execution)?.ref;
          if (found === undefined || found.installation !== origin.installation || found.incarnation !== origin.incarnation)
            return {
              _tag: 'Refused',
              origin,
              pid,
              reason: 'execution-unknown',
              detail: 'the host holds no execution under this origin',
              steps: [],
            } as const;
          return yield* registry.residuals.end(origin, pid);
        }),
      ),
    signal: (claim, execution, name) => signal(registry, claim, execution, name),
    ending: (execution, remeasure) => ending(registry, execution, remeasure),
  });
};
