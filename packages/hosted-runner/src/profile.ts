import { CALL_ENVELOPE_MS } from '@runlith/agent/callProgress';
import { HOST_COMMAND, type AcpProfile } from '@runlith/tagma/adapter/harness';
import type { Extension, Notification } from './wire/extensions.js';

export type ClientProfile = {
  readonly id: string;
  readonly storage: { readonly environment: string; readonly folder: string };
  readonly login: string;
  readonly extensions: readonly (Extension | Notification)[];
  readonly compaction: 'session' | 'foreign' | 'vendor';
  readonly usage: AcpProfile['proves']['usage'];
  readonly midTurn?: AcpProfile['midTurn'];
  readonly web?: AcpProfile['web'];
  readonly program?: string;
  readonly aside?: AcpProfile['proves']['aside'];
  readonly toolCatalog?: AcpProfile['toolCatalog'];
};

export const clientProfile = ({
  id,
  storage,
  login,
  extensions,
  compaction,
  usage,
  midTurn = 'after-turn',
  web = 'none',
  program,
  aside = 'none',
  toolCatalog = 'turn',
}: ClientProfile): AcpProfile => ({
  ...(program === undefined ? {} : { program }),
  argv: (choice) => [
    HOST_COMMAND,
    'harness-run',
    id,
    ...(choice === undefined ? [] : ['--model', choice.model, ...(choice.rung === null ? [] : ['--effort', choice.rung])]),
  ],
  titles: false,
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
  web,
  mode: 'agent',
  proves: {
    law: 'every-call',
    touch: 'reads-and-writes',
    authorship: 'recorded',
    fork: true,
    rewind: true,
    compaction: compaction === 'session' ? true : compaction,
    continue: true,
    usage,
    aside,
  },
  toolCatalog,
  storage,
  graceMs: 5_000,
  callEnvelopeMs: CALL_ENVELOPE_MS,
  handshakeMs: 60_000,
  login: { command: login, codes: [-32000] },
  lockedCode: null,
  otherMutates: false,
  midTurn,
  sharedSessions: false,
  extensions,
});
