import { CALL_ENVELOPE_MS } from '@runlith/agent/callProgress';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import type { AcpProfile } from '../../protocol/profile.js';
import { COMPACTED, RETRYING, SAID } from '../../contract/wire/extensions.js';

export const cursorAcp: AcpProfile = {
  argv: (choice) => [
    WORLD_COMMAND,
    'harness-run',
    'cursor',
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
  serves: 'cursor',
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
  storage: { environment: 'CURSOR_DATA_DIR', folder: 'cursor-sdk' },
  graceMs: 5_000,
  callEnvelopeMs: CALL_ENVELOPE_MS,
  handshakeMs: 60_000,
  login: { command: 'sign in to Cursor on the Providers screen', codes: [-32000] },
  lockedCode: null,
  otherMutates: false,
  midTurn: 'after-turn',
  sharedSessions: false,
  extensions: [SAID, COMPACTED, RETRYING],
};
