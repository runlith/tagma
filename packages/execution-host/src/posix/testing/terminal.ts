import { Effect } from 'effect';
import { ChannelFailed, type HeldExecution } from '../../holder/Holder';
import { Descriptor } from '../Descriptor';
import { isThreadTerminal } from '../TerminalThread';

import type { TerminalFacts } from '../native';

export const terminalFacts = (held: HeldExecution): Effect.Effect<TerminalFacts, ChannelFailed> => {
  const terminal = held.channels._tag === 'pty' ? held.channels.terminal : undefined;
  if (terminal instanceof Descriptor) return terminal.facts(held.pid);
  if (terminal !== undefined && isThreadTerminal(terminal)) return terminal.facts(held.pid);
  return Effect.fail(new ChannelFailed({ reason: 'closed', detail: 'the execution holds no POSIX terminal' }));
};
