import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { hosted } from './host';
import { posix } from './posix';
import { Host } from './session';
import { machineLoadContract } from './serving';

layer(hosted('POSIX', posix()).layer, { excludeTestServices: true })('POSIX load capability', (it) => {
  it.effect('refuses live machine load when no usage policy was declared', () => Effect.flatMap(Host, machineLoadContract), 9_000);
});
