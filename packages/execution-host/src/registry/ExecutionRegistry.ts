import { Context, Effect, Layer, References, Tracer } from 'effect';
import { statVolume, type VolumeReader } from '../RecordVolume';
import { openState } from './state';
import { adoptHeld } from './adoption';
import { Executions, executionsOf } from './launch';
import { ExecutionRequest, executionRequestOf } from './operations';
import { HostCommands, HostProcessFacts, hostCommandsOf, hostProcessFactsOf } from './inventory';
import { InputLanes, CustodyControl, PaceControl, inputLanesOf, custodyControlOf, paceControlOf } from './control';
import { ExecutionStop, executionStopOf } from './stops';
import { HostByteRecords, TerminalScreen, hostByteRecordsOf, terminalScreenOf } from './reads';
import { ExecutionRetirement, HostDisown, executionRetirementOf, hostDisownOf } from './retention';
import { HostLifecycle, hostLifecycleOf } from './shutdown';

export const ExecutionRegistry = {
  layer: (options: { readonly volumeOf?: VolumeReader } = {}) => Layer.effectContext(make({ volumeOf: options.volumeOf ?? statVolume })),
};

const make = Effect.fnUntraced(function* (options: { readonly volumeOf: VolumeReader }) {
  const registry = yield* openState(options);
  yield* Effect.forkIn(
    Effect.updateContext(registry.shelf.evictGenerations, (context: Context.Context<never>) =>
      Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
    ),
    registry.registryScope,
  );
  const unadopted = yield* adoptHeld(registry);
  yield* Effect.forkIn(registry.shelf.evictKept, registry.registryScope);
  yield* Effect.forEach(
    unadopted,
    (refused) =>
      Effect.logWarning(`the holder keeps ${refused.execution} and this logic did not take it up: ${refused.reason}: ${refused.detail}`),
    { discard: true },
  );
  return Context.make(Executions, executionsOf(registry)).pipe(
    Context.add(ExecutionRequest, executionRequestOf(registry)),
    Context.add(HostCommands, hostCommandsOf(registry)),
    Context.add(InputLanes, inputLanesOf(registry)),
    Context.add(CustodyControl, custodyControlOf(registry)),
    Context.add(ExecutionStop, executionStopOf(registry)),
    Context.add(HostByteRecords, hostByteRecordsOf(registry)),
    Context.add(TerminalScreen, terminalScreenOf(registry)),
    Context.add(HostProcessFacts, hostProcessFactsOf(registry)),
    Context.add(ExecutionRetirement, executionRetirementOf(registry)),
    Context.add(HostLifecycle, hostLifecycleOf(registry)),
    Context.add(PaceControl, paceControlOf(registry)),
    Context.add(HostDisown, hostDisownOf(registry)),
  );
});
