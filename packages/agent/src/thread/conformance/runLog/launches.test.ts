import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeNativeLaunches } from './launches';

describeNativeLaunches('InMemory', openMemoryStorage, it.live);
