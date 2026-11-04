import { getPriority } from 'node:os';
import { Effect } from 'effect';
import { ChannelFailed } from '../../../holder/Holder';
import type { FixtureSystem } from '../../testing/System';

export const system: FixtureSystem = {
  libc: 'libc.so.6',
  nofile: 7,
  errno: '__errno_location',
  priorityColumn: 'ni=',
  priorities: (full) => ({ low: String(Math.max(Number(full), 5)), lowest: '19' }),
  background: (pid) =>
    Effect.try({
      try: () => getPriority(pid) === 19,
      catch: (error) => new ChannelFailed({ reason: 'os', detail: String(error) }),
    }),
  isolated: () => Effect.succeed(undefined),
};
