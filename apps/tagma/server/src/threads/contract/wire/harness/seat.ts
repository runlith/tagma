import type { ThreadTransport } from '@runlith/agent/thread/rows';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { TransportBinding, TransportCapabilities } from '@runlith/agent/thread/record';
import type { HarnessTransport } from './names.js';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { ExternalSession } from './externalSession.js';
import { currentEffort, currentModel } from './observation.js';

export const EXTERNAL_PROVIDER = 'external';

export const harnessTransportOf = (binding: TransportBinding): HarnessTransport => (binding.adapter === 'terminal' ? 'terminal' : 'acp');

export type SeatSelection = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
};

export type SeatChoice = SeatSelection & { readonly account?: string | null; readonly switches: ModelSwitches };

export type KernelSeat = ThreadTransport & {
  readonly selection: SeatSelection;
  readonly account: string | null;
  readonly switches: ModelSwitches;
};

export type HarnessSeat = {
  readonly facet: ExternalSession;
  readonly kernel: KernelSeat | null;
};

export type SeatedHarness = HarnessSeat & { readonly kernel: KernelSeat };

export const HARNESS_OFFER: TransportCapabilities = {
  ...NATIVE_CAPABILITIES,
  judgedModel: false,
  steer: 'none',
  withdraw: false,
  history: 'none',
  compaction: 'none',
  modelMove: 'pinned',
  pictures: false,
  web: 'none',
  law: null,
  touch: null,
  authorship: null,
  callEnvelopeMs: null,
  continue: false,
  feed: 'turns',
  usage: 'none',
  aside: 'none',
};

const modelCapabilities = (models: ModelCatalog, provider: string, model: string | null) =>
  model === null || !models.registered(provider)
    ? undefined
    : models.modelsFor(provider, 'text').find((option) => option.id === model)?.capabilities;

export const nativeCapabilities = (models: ModelCatalog, provider: string, model: string | null): TransportCapabilities => ({
  ...NATIVE_CAPABILITIES,
  pictures: modelCapabilities(models, provider, model)?.includes('vision') ?? true,
});

export const servedSelection = (
  provider: string,
  chosen: { readonly model: string | null; readonly reasoning: string | null } | undefined,
  facet: ExternalSession | null,
): ThreadModelSelection | null => {
  const model = chosen?.model ?? (facet === null ? null : currentModel(facet.observation));
  return model === null
    ? null
    : { provider, model, reasoning: chosen?.reasoning ?? (facet === null ? null : currentEffort(facet.observation)) };
};

export type HarnessRoad = ThreadTransport & SeatSelection;
