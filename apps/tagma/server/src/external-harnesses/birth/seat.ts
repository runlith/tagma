import type { TransportCapabilities, TransportCopies } from '@runlith/agent/thread/record';
import type { DeclaredHistory } from '../../threads/store/seat.js';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import { EXTERNAL_PROVIDER, type HarnessSeat, type KernelSeat, type SeatedHarness } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { harnessPresentation, servingProvider } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { transcriptUsage } from '../metadata/words.js';
import type { AcpProfile } from '@runlith/tagma/adapter/harness';
import type { HarnessTransportOffer } from '../contract/service/table.js';
import type { HarnessProfile } from '../settings.js';

export const acpCapabilities = (profile: AcpProfile): TransportCapabilities => ({
  messaging: true,
  judgedModel: false,
  steer: profile.midTurn === 'steer' ? 'step' : 'none',
  withdraw: profile.midTurn === 'steer',
  history: profile.proves.fork && profile.proves.rewind ? 'session' : 'none',
  compaction: profile.proves.compaction === true ? 'session' : profile.proves.compaction === false ? 'none' : profile.proves.compaction,
  toolCatalog: profile.toolCatalog,
  modelMove: 'live',
  openings: 'core',
  pictures: true,
  web: profile.web,
  law: profile.proves.law,
  touch: profile.proves.touch,
  authorship: profile.proves.authorship,
  callEnvelopeMs: profile.callEnvelopeMs,
  screen: false,
  continue: profile.proves.continue,
  feed: 'full',
  usage: profile.proves.usage,
  aside: profile.proves.aside,
});

export const acpKernel = (
  adapter: HarnessAdapter,
  agent: string | null,
  asked: HarnessAskedModel | undefined,
  switches: ModelSwitches,
  account: string | null = null,
): KernelSeat => {
  const profile = adapter.acp;
  if (profile === undefined) throw new Error(`${adapter.harness} carries no ACP profile, so no thread of it runs on acp.`);
  return {
    transport: { adapter: 'acp', profile: adapter.harness, agent },
    capabilities: acpCapabilities(profile),
    selection: {
      provider: servingProvider(adapter, 'acp') ?? EXTERNAL_PROVIDER,
      model: asked?.model ?? null,
      reasoning: asked?.reasoning ?? null,
    },
    account,
    switches,
  };
};

export const terminalHistory = (adapter: HarnessAdapter, plain: boolean): DeclaredHistory => {
  const cut = adapter.launch?.cut;
  const copies: TransportCopies = plain
    ? { whole: cut?.whole?._tag === 'Prepare' ? 'vendor' : 'none', point: 'none' }
    : { whole: cut?.whole == null ? 'record' : 'vendor', point: cut?.point == null ? 'record' : 'vendor' };
  return { history: copies.whole === 'none' && copies.point === 'none' ? 'none' : 'session', copies };
};

export const terminalCapabilities = (adapter: HarnessAdapter, plain: boolean): TransportCapabilities => {
  const events = plain ? undefined : adapter.hooks?.events;
  return {
    messaging: !plain,
    judgedModel: false,
    steer: adapter.steer,
    withdraw: false,
    ...terminalHistory(adapter, plain),
    compaction: 'none',
    modelMove: 'pinned',
    openings: plain ? 'core' : 'core-and-observed',
    pictures: false,
    web: 'none',
    law: events?.permission == null ? null : 'asked-calls',
    touch: events?.postRead != null ? 'reads-and-writes' : events?.postWrite != null ? 'writes' : null,
    authorship: events?.postWrite != null ? 'observed' : null,
    callEnvelopeMs: adapter.callEnvelopeMs,
    screen: true,
    continue: true,
    feed: 'turns',
    usage: transcriptUsage(adapter) ? 'partial' : 'none',
    aside: 'none',
  };
};

export const terminalKernel = (
  adapter: HarnessAdapter,
  asked: HarnessAskedModel | undefined,
  plain: boolean,
  switches: ModelSwitches,
  account: string | null = null,
): KernelSeat => ({
  transport: { adapter: 'terminal', profile: adapter.harness, agent: null },
  capabilities: terminalCapabilities(adapter, plain),
  selection: {
    provider: adapter.launch?.model?.provider ?? EXTERNAL_PROVIDER,
    model: asked?.model ?? null,
    reasoning: asked?.reasoning ?? null,
  },
  account,
  switches,
});

export const birthSeat = (
  adapter: HarnessAdapter,
  offer: HarnessTransportOffer,
  asked: HarnessAskedModel | undefined,
  profile: HarnessProfile,
): HarnessSeat =>
  offer.transport === 'acp'
    ? { facet: harnessFacet(adapter.harness, harnessPresentation(adapter)), kernel: acpKernel(adapter, offer.agent, asked, {}) }
    : {
        facet: {
          ...harnessFacet(adapter.harness, harnessPresentation(adapter)),
          home: profile.home,
          plain: profile.plain,
          permissionMode: profile.permissionMode,
        },
        kernel: terminalKernel(adapter, asked, profile.plain === true, {}),
      };
