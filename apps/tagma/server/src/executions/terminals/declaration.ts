import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { HostRequestKey, Transport } from '@runlith/executions/protocol/execution';
import type { StdinPolicy } from '@runlith/executions/protocol/launch';
import type { TerminalLifetime } from '../contract/wire/terminals.js';
import { spawnInteractive } from './subjectPolicy.js';

export const refuseLanelessStart = (lifetime: TerminalLifetime, transport: Transport): GateRefusal<'terminal-start-no-lane'> =>
  new GateRefusal(
    'terminal-start-no-lane',
    transport === 'pty'
      ? 'this start declares a written stdin, and a pty has no separate stdin to write: its input rides the terminal itself, typed through a lane'
      : `a ${lifetime} execution ends with the call that started it, so a written stdin declared here opens no lane and nothing would ever type into it`,
    transport === 'pty'
      ? ['start a pipes execution to declare a written stdin', 'drop the stdin declaration and type into the pty with write_terminal']
      : ['start a held execution to declare a written stdin', 'drop the stdin declaration to launch bare'],
  );

export type StartDeclaration =
  | { readonly _tag: 'Bare' }
  | { readonly _tag: 'Interactive'; readonly interactive: { readonly actor: Principal; readonly binding: BindingId } }
  | { readonly _tag: 'Refused'; readonly refusal: GateRefusal<'terminal-start-no-lane'> };

export const startDeclaration = (input: {
  readonly actor: Principal;
  readonly operation: HostRequestKey;
  readonly lifetime: TerminalLifetime;
  readonly transport: Transport;
  readonly stdin?: StdinPolicy;
}): StartDeclaration => {
  const interactive = spawnInteractive(input);
  if (interactive === null) {
    return input.stdin === 'pipe' ? { _tag: 'Refused', refusal: refuseLanelessStart(input.lifetime, input.transport) } : { _tag: 'Bare' };
  }
  return { _tag: 'Interactive', interactive };
};
