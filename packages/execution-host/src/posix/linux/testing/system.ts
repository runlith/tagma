import { appendFileSync, readFileSync } from 'node:fs';
import { getPriority } from 'node:os';
import { Effect } from 'effect';
import { HolderUnavailable } from '../../../holder-client/Connection';
import { ChannelFailed } from '../../../holder/Holder';
import { processWorker } from '../processes';
import type { FixtureSystem } from '../../testing/System';

const CAP_SYS_NICE = 23n;
const effective = /^CapEff:\s*([0-9a-f]+)$/mu.exec(readFileSync('/proc/self/status', 'utf8'))?.[1];

export const system: FixtureSystem = {
  libc: 'libc.so.6',
  nofile: 7,
  errno: '__errno_location',
  raises: effective !== undefined && ((BigInt(`0x${effective}`) >> CAP_SYS_NICE) & 1n) === 1n,
  priorityColumn: 'ni=',
  priorities: (full) => ({ low: String(Math.max(Number(full), 5)), lowest: '19' }),
  background: (pid) =>
    Effect.try({
      try: () => getPriority(pid) === 19,
      catch: (error) => new ChannelFailed({ reason: 'os', detail: String(error) }),
    }),
  distinct: (holder, label) =>
    Effect.try({
      try: () => appendFileSync(holder, `\n${label}`),
      catch: (error) => new HolderUnavailable({ detail: `the distinct holder could not be written: ${String(error)}` }),
    }),
  processWorker,
  isolated: () => Effect.succeed(undefined),
};
