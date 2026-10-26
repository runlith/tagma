import { Context, Layer } from 'effect';
import { lazyLayer, manifest } from './contract/service/manifest.js';
import { GraphStore, MachineStore } from './contract/service/store.js';
import { GraphUnits, MachineUnits } from './contract/service/units.js';
import { RELOCATIONS } from './contract/service/relocation.js';
import { snapshotRelocation } from './store/relocation.js';
import { heavyPool } from './contract/service/capacity.js';

export const platform = manifest({
  id: 'platform',
  contributions: RELOCATIONS.of(snapshotRelocation),
  pools: (machine) => [heavyPool(machine)],
  subjects: async () => (await import('./subjects.js')).PLATFORM_SUBJECTS,
  tables: async () => {
    const [{ session }] = await Promise.all([import('./store/writers.js')]);
    return { entities: [session], history: [] };
  },
  lifetimes: {
    preparation: lazyLayer(
      () => import('./durable/flush.js'),
      ({ flushPreparationLayer }) => flushPreparationLayer,
    ),
    installation: lazyLayer(
      () => Promise.all([import('./store/units.js'), import('./store/writers.js'), import('./watch/tickets.js')]),
      ([{ unitsLayer }, { machineWritersLayer, writerRegisterLayer }, { watchTicketsLayer }]) =>
        Layer.mergeAll(
          unitsLayer(MachineUnits, MachineStore),
          unitsLayer(GraphUnits, GraphStore),
          writerRegisterLayer,
          machineWritersLayer,
          watchTicketsLayer,
        ),
    ),
    call: (input: { readonly machine: MachineStore['Service'] }) => Context.make(MachineStore, input.machine),
  },
});
