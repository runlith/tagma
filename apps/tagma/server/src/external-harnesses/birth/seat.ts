import type { TransportCapabilities, TransportCopies } from '@runlith/agent/thread/record';
import type { DeclaredHistory } from '../../threads/store/seat.js';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { EXTERNAL_PROVIDER, type HarnessSeat, type KernelSeat, type SeatedHarness } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { harnessAdapter, servingProvider } from '../contract/service/table.js';
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
  compaction: profile.proves.compaction === 'foreign' ? 'foreign' : profile.proves.compaction ? 'session' : 'none',
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
  name: HarnessName,
  agent: string | null,
  asked: HarnessAskedModel | undefined,
  switches: ModelSwitches,
  account: string | null = null,
): KernelSeat => {
  const adapter = harnessAdapter(name);
  const profile = adapter.acp;
  if (profile === undefined) throw new Error(`${name} carries no ACP profile, so no thread of it runs on acp.`);
  return {
    transport: { adapter: 'acp', profile: name, agent },
    capabilities: acpCapabilities(profile),
    selection: {
      provider: servingProvider(name, 'acp') ?? EXTERNAL_PROVIDER,
      model: asked?.model ?? null,
      reasoning: asked?.reasoning ?? null,
    },
    account,
    switches,
  };
};

export const terminalHistory = (name: HarnessName, plain: boolean): DeclaredHistory => {
  const cut = harnessAdapter(name).launch?.cut;
  const copies: TransportCopies = plain
    ? { whole: cut?.whole?._tag === 'Prepare' ? 'vendor' : 'none', point: 'none' }
    : { whole: cut?.whole == null ? 'record' : 'vendor', point: cut?.point == null ? 'record' : 'vendor' };
  return { history: copies.whole === 'none' && copies.point === 'none' ? 'none' : 'session', copies };
};

export const terminalCapabilities = (name: HarnessName, plain: boolean): TransportCapabilities => {
  const events = plain ? undefined : harnessAdapter(name).hooks?.events;
  return {
    messaging: !plain,
    judgedModel: false,
    steer: harnessAdapter(name).steer,
    withdraw: false,
    ...terminalHistory(name, plain),
    compaction: 'none',
    modelMove: 'pinned',
    openings: plain ? 'core' : 'core-and-observed',
    pictures: false,
    web: 'none',
    law: events?.permission == null ? null : 'asked-calls',
    touch: events?.postRead != null ? 'reads-and-writes' : events?.postWrite != null ? 'writes' : null,
    authorship: events?.postWrite != null ? 'observed' : null,
    callEnvelopeMs: harnessAdapter(name).callEnvelopeMs,
    screen: true,
    continue: true,
    feed: 'turns',
    usage: transcriptUsage(harnessAdapter(name)) ? 'partial' : 'none',
    aside: 'none',
  };
};

export const terminalKernel = (
  name: HarnessName,
  asked: HarnessAskedModel | undefined,
  plain: boolean,
  switches: ModelSwitches,
  account: string | null = null,
): KernelSeat => ({
  transport: { adapter: 'terminal', profile: name, agent: null },
  capabilities: terminalCapabilities(name, plain),
  selection: {
    provider: harnessAdapter(name).launch?.model?.provider ?? EXTERNAL_PROVIDER,
    model: asked?.model ?? null,
    reasoning: asked?.reasoning ?? null,
  },
  account,
  switches,
});

export const birthSeat = (
  name: HarnessName,
  offer: HarnessTransportOffer,
  asked: HarnessAskedModel | undefined,
  profile: HarnessProfile,
): HarnessSeat =>
  offer.transport === 'acp'
    ? { facet: harnessFacet(name), kernel: acpKernel(name, offer.agent, asked, {}) }
    : {
        facet: { ...harnessFacet(name), home: profile.home, plain: profile.plain, permissionMode: profile.permissionMode },
        kernel: terminalKernel(name, asked, profile.plain === true, {}),
      };
