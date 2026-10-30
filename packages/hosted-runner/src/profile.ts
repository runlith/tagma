import { CALL_ENVELOPE_MS } from '@runlith/agent/callProgress';
import { HOST_COMMAND, type AcpProfile } from '@runlith/tagma/adapter/harness';
import type { Notification } from './wire/extensions.js';

export type ClientProfile = {
  readonly id: string;
  readonly storage: { readonly environment: string; readonly folder: string };
  readonly login: string;
  readonly extensions: readonly Notification[];
};

export const clientProfile = ({ id, storage, login, extensions }: ClientProfile): AcpProfile => ({
  argv: (choice) => [
    HOST_COMMAND,
    'harness-run',
    id,
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
  serves: id,
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
  storage,
  graceMs: 5_000,
  callEnvelopeMs: CALL_ENVELOPE_MS,
  handshakeMs: 60_000,
  login: { command: login, codes: [-32000] },
  lockedCode: null,
  otherMutates: false,
  midTurn: 'after-turn',
  sharedSessions: false,
  extensions,
});
