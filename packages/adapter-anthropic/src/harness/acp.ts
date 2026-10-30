import { CALL_ENVELOPE_MS } from '@runlith/agent/callProgress';
import { EXTENSIONS, NOTIFICATIONS } from '@runlith/hosted-runner/wire/extensions';
import { chosenModelArgv, HOST_COMMAND, type AcpProfile, type HarnessModelArgv } from '@runlith/tagma/adapter/harness';
import { CLAUDE_CODE_PROVIDER } from '../models/anthropic.js';

export const claudeAcp = (model: HarnessModelArgv): AcpProfile => ({
  argv: (choice) => [HOST_COMMAND, 'harness-run', 'claude-code', ...chosenModelArgv(model, choice)],
  untitled: ['--untitled'],
  configure: (choice, switches) => [
    ...(choice === undefined
      ? []
      : [{ configId: 'model', value: choice.model }, ...(choice.rung === null ? [] : [{ configId: 'effort', value: choice.rung }])]),
    ...(switches.reasoningDisplay === undefined ? [] : [{ configId: 'thinking', value: switches.reasoningDisplay }]),
  ],
  reportedModel: 'model',
  hosts: 'tagma',
  serves: CLAUDE_CODE_PROVIDER,
  web: 'vendor',
  mode: 'bypassPermissions',
  proves: {
    law: 'every-call',
    touch: 'reads-and-writes',
    authorship: 'recorded',
    fork: true,
    rewind: true,
    compaction: true,
    continue: true,
    usage: 'measured',
    aside: 'session',
  },
  graceMs: 5_000,
  callEnvelopeMs: CALL_ENVELOPE_MS,
  handshakeMs: 60_000,
  login: { command: 'claude auth login', codes: [-32000] },
  lockedCode: null,
  otherMutates: false,
  midTurn: 'steer',
  sharedSessions: true,
  extensions: [...EXTENSIONS, ...NOTIFICATIONS],
});
