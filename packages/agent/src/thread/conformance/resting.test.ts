import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadResting } from './resting';

describeThreadResting('InMemory', openMemoryStorage, it.live);
