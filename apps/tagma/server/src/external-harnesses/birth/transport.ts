import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { transportOf, type HarnessTransportOffer } from '../contract/service/table.js';
import { harnessTransport } from '../settings.js';

export const birthTransport = (
  settings: Settings['Service'],
  adapter: HarnessAdapter,
  projectId: number,
): Effect.Effect<HarnessTransportOffer, StoreFailure | GateRefusal> =>
  Effect.flatMap(settings.value(harnessTransport, projectId), (asked) =>
    transportOf(adapter, adapter.acp?.hosts == null ? asked[adapter.harness] : undefined),
  );
