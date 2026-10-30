import { CALL_ENVELOPE_MS } from '@runlith/agent/callProgress';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import type { AcpProfile } from '@runlith/tagma/adapter/harness';
import { SAID } from '../../contract/wire/extensions.js';

export const opencodeAcp: AcpProfile = {
  argv: (choice) => [
    WORLD_COMMAND,
    'harness-run',
    'opencode',
    ...(choice === undefined ? [] : ['--model', choice.model, ...(choice.rung === null ? [] : ['--effort', choice.rung])]),
  ],
  configure: (choice, switches) => [
    ...(choice === undefined
      ? []
      : [
          { configId: 'model', value: choice.model },
          { configId: 'effort', value: choice.rung ?? '' },
        ]),
    { configId: 'parameters', value: JSON.stringify(switches) },
  ],
  reportedModel: 'model',
  hosts: 'tagma',
  serves: 'opencode',
  web: 'none',
  mode: 'agent',
  proves: {
    law: 'every-call',
    touch: 'reads-and-writes',
    authorship: 'recorded',
    fork: true,
    rewind: true,
    compaction: 'foreign',
    continue: true,
    usage: 'measured',
    aside: 'none',
  },
  toolCatalog: 'turn',
  storage: { environment: 'OPENCODE_DATA_DIR', folder: 'opencode' },
  graceMs: 5_000,
  callEnvelopeMs: CALL_ENVELOPE_MS,
  handshakeMs: 60_000,
  login: { command: 'sign in with the official OpenCode CLI on the Providers screen', codes: [-32000] },
  lockedCode: null,
  otherMutates: false,
  midTurn: 'after-turn',
  sharedSessions: false,
  extensions: [SAID],
};
