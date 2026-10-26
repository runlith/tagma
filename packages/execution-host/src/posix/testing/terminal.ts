import { Effect } from 'effect';
import { ChannelFailed, type HeldExecution } from '../../holder/Holder';
import { Descriptor } from '../Descriptor';

import type { TerminalFacts } from '../native';

export const terminalFacts = (held: HeldExecution): Effect.Effect<TerminalFacts, ChannelFailed> => {
  const terminal = held.channels._tag === 'pty' ? held.channels.terminal : undefined;
  return terminal instanceof Descriptor
    ? terminal.facts(held.pid)
    : Effect.fail(new ChannelFailed({ reason: 'closed', detail: 'the execution holds no POSIX terminal' }));
};
