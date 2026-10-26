import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadRewind } from './rewind';

describeThreadRewind('InMemory', openMemoryStorage, it.live);
