import { Effect } from 'effect';
import { HolderUnavailable } from '../../../holder-client/Connection';
import { background } from './tempo';
import { isolatedProcess } from './isolated';
import { processWorker } from '../processes';
import type { FixtureSystem } from '../../testing/System';

export const system: FixtureSystem = {
  libc: '/usr/lib/libSystem.B.dylib',
  nofile: 8,
  errno: '__error',
  raises: true,
  priorityColumn: 'pri=',
  priorities: () => ({ low: '20', lowest: '4' }),
  background,
  distinct: (holder, label) =>
    Effect.suspend(() => {
      const signed = Bun.spawnSync(['/usr/bin/codesign', '--force', '-s', '-', '-i', `tagma.holder.${label}`, holder], {
        stdout: 'ignore',
        stderr: 'pipe',
      });
      return signed.exitCode === 0
        ? Effect.void
        : Effect.fail(new HolderUnavailable({ detail: `the distinct holder could not be signed: ${signed.stderr.toString()}` }));
    }),
  processWorker,
  isolated: isolatedProcess,
};
