import type { SessionIdentity } from '../../platform/contract/wire/session.js';

import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { Transport } from '@runlith/executions/protocol/execution';
import { identityVariables } from '../../platform/credentials/grants.js';
import { TERMINAL_VARIABLE } from '../../platform/contract/service/credentials.js';

const terminalVariables = (version: string): ReadonlyArray<{ readonly name: string; readonly value: string }> => [
  { name: 'TERM', value: 'xterm-256color' },
  { name: 'COLORTERM', value: 'truecolor' },
  { name: 'TERM_PROGRAM', value: 'Tagma' },
  { name: 'TERM_PROGRAM_VERSION', value: version },
  { name: 'FORCE_HYPERLINK', value: '1' },
];

export const TERMINAL_LOCALE = { name: 'LANG', value: 'en_US.UTF-8' } as const;

const COLOUR_OPT_OUTS: ReadonlyArray<{ readonly name: string; readonly value?: string }> = [
  { name: 'NO_COLOR' },
  { name: 'FORCE_COLOR', value: '0' },
  { name: 'CLICOLOR', value: '0' },
];

export const terminalEnvironment = (
  transport: Transport,
  requested: CommandEnvironmentRequest | undefined,
  version: string,
): CommandEnvironmentRequest => {
  const asked = requested ?? { inherit: true, entries: [] };
  if (transport !== 'pty') return asked;
  return {
    inherit: asked.inherit,
    entries: [
      ...terminalVariables(version).map(set),
      ...COLOUR_OPT_OUTS.map(drop),
      { _tag: 'Default', name: TERMINAL_LOCALE.name, value: TERMINAL_LOCALE.value } as const,
      ...asked.entries,
    ],
  };
};

export const keyedEnvironment = (
  request: CommandEnvironmentRequest,
  shellKey: string | undefined,
  identity: SessionIdentity['Service'],
): CommandEnvironmentRequest => ({
  inherit: request.inherit,
  entries: [
    ...request.entries,
    ...(shellKey === undefined
      ? [{ _tag: 'Unset', name: TERMINAL_VARIABLE } as const]
      : [
          ...identityVariables(identity)
            .filter((name) => name !== TERMINAL_VARIABLE)
            .map((name) => ({ _tag: 'Unset', name }) as const),
          { _tag: 'Set', name: TERMINAL_VARIABLE, value: shellKey } as const,
        ]),
  ],
});

export const requestedEnvironment = (env: Readonly<Record<string, string | null>>): CommandEnvironmentRequest => ({
  inherit: true,
  entries: Object.entries(env).map(([name, value]) =>
    value === null ? ({ _tag: 'Unset', name } as const) : ({ _tag: 'Set', name, value } as const),
  ),
});

const set = (variable: { readonly name: string; readonly value: string }) =>
  ({ _tag: 'Set', name: variable.name, value: variable.value }) as const;

const drop = (variable: { readonly name: string; readonly value?: string }) =>
  variable.value === undefined
    ? ({ _tag: 'Unset', name: variable.name } as const)
    : ({ _tag: 'UnsetIf', name: variable.name, value: variable.value } as const);
