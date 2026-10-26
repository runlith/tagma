import { it } from '@runlith/effect-test';
import { describeThreadInboxPort } from './inbox';
import { openMemoryStorage } from './memoryStorage';

describeThreadInboxPort('InMemory', openMemoryStorage, it.live);
