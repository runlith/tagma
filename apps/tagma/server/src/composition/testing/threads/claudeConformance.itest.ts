import { describe } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { Effect } from 'effect';
import { describeTransportStops } from '@runlith/agent/thread/conformance/transportStops';
import { describeTransportRestarts } from '@runlith/agent/thread/conformance/transportRestarts';
import { describeTransportWords } from '@runlith/agent/thread/conformance/transportWords';
import { claudeAgent } from './protocolAgents.js';
import { LIBRARY, ProtocolRig, protocolFixture } from './protocolRig.js';
import { protocolStopRig } from './protocolStopRig.js';
import { protocolWordRig } from './protocolWordRig.js';

describe.skipIf(!existsSync(LIBRARY))('the transport conformance set on ACP with the Claude runner over a scripted Claude Code', () => {
  layer(protocolFixture('claude-conformance'), { excludeTestServices: true })('protocol rig', (it) => {
    describeTransportStops(
      'acp (Claude runner)',
      () => Effect.map(ProtocolRig, (rig) => protocolStopRig(rig, claudeAgent(rig))),
      it.effect,
      ['thinking'],
    );
    describeTransportRestarts(
      'acp (Claude runner)',
      () => Effect.map(ProtocolRig, (rig) => protocolStopRig(rig, claudeAgent(rig), 'restarts')),
      it.effect,
      undefined,
    );
    describeTransportWords(
      'acp (Claude runner)',
      () => Effect.map(ProtocolRig, (rig) => protocolWordRig(rig, claudeAgent(rig))),
      it.effect,
      ['running'],
    );
  });
});
