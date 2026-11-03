import { Effect, Layer, Semaphore } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { MachineRegistry } from '../contract/service/registry.js';

export const registryExportLayer: Layer.Layer<never, never, MachineRegistry | MachineUnits> = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* MachineRegistry;
    const units = yield* MachineUnits;
    const gate = yield* Semaphore.make(1);
    const dump = gate.withPermits(1)(
      registry.dump.pipe(Effect.catchCause((cause) => Effect.logError('machine registry dump failed', cause))),
    );
    yield* registry.watch(units.markReadOnly(dump));
  }),
);
