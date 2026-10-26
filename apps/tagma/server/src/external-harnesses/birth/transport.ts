import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { HarnessName, HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import { harnessAdapter, transportOf, type HarnessTransportOffer } from '../contract/service/table.js';
import { harnessTransport } from '../settings.js';

export const birthTransport = (
  settings: Settings['Service'],
  name: HarnessName,
  projectId: number,
): Effect.Effect<HarnessTransportOffer, StoreFailure | GateRefusal> =>
  Effect.flatMap(settings.value(harnessTransport, projectId), (asked) => {
    const roads: Partial<Record<HarnessName, HarnessTransport>> = asked;
    return transportOf(name, harnessAdapter(name).acp?.hosts == null ? roads[name] : undefined);
  });
