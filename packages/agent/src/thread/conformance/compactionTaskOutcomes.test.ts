import { it } from '@runlith/effect-test';
import { describeThreadCompactionTaskOutcomes } from './compactionParent';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionTaskOutcomes('InMemory', openMemoryStorage, it.live);
