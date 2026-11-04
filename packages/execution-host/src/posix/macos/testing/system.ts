import { background } from './tempo';
import { isolatedProcess } from './isolated';
import type { FixtureSystem } from '../../testing/System';

export const system: FixtureSystem = {
  libc: '/usr/lib/libSystem.B.dylib',
  nofile: 8,
  errno: '__error',
  priorityColumn: 'pri=',
  priorities: () => ({ low: '20', lowest: '4' }),
  background,
  isolated: isolatedProcess,
};
