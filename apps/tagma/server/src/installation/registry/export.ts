import { Effect, Layer, Semaphore } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { ProjectPolicy } from '../../graph/contract/service/serving.js';
import { dumpMachineRegistry } from './file.js';

export const registryExportLayer: Layer.Layer<never, never, MachineStore | MachineUnits | ProjectChanges | SettingChanges | ProjectPolicy> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const units = yield* MachineUnits;
      const gate = Semaphore.makeUnsafe(1);
      const dump = gate.withPermits(1)(
        dumpMachineRegistry().pipe(
          Effect.provideService(MachineStore, store),
          Effect.catchCause((cause) => Effect.logError('machine registry dump failed', cause)),
        ),
      );
      const reading = units.markReadOnly(dump);
      const projects = yield* ProjectChanges;
      const settings = yield* SettingChanges;
      const policies = yield* ProjectPolicy;
      const leaving = [projects.changed.subscribe(reading), settings.subscribe(() => reading), policies.subscribe(() => reading)];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const leave of leaving) leave();
        }),
      );
    }),
  );
