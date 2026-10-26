import { it } from '@runlith/effect-test';
import { describeThreadCompactionPasses } from './compactionPasses';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionPasses('InMemory', openMemoryStorage, it.live);
