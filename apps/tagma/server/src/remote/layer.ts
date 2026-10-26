import { Context, Effect, Layer } from 'effect';
import type { MachineStore } from '../platform/contract/service/store.js';
import type { MachineUnits } from '../platform/contract/service/units.js';
import type { Settings } from '../settings/contract/service/values.js';
import { Access } from './contract/service/access.js';
import { Devices } from './contract/service/devices.js';
import type { Exposure } from './contract/service/exposure.js';
import { PlacedSites, type WantedSites } from './contract/service/sites.js';
import { makeKeeper } from './keeper.js';
import { makeReach } from './reach.js';
import { ledgerLayer } from './store/ledger.js';

export const remoteLayer: Layer.Layer<
  Access | Devices | PlacedSites,
  never,
  MachineStore | MachineUnits | Settings | Exposure | WantedSites
> = Layer.effectContext(
  Effect.gen(function* () {
    const reach = yield* makeReach;
    const devices = yield* makeKeeper({ reach });
    return Context.make(Access, reach).pipe(Context.add(PlacedSites, reach), Context.add(Devices, devices));
  }),
).pipe(Layer.provide(ledgerLayer));
