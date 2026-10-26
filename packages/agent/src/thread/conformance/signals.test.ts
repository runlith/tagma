import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadSignals } from './signals';

describeThreadSignals('InMemory', openMemoryStorage, it.live);
