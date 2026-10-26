import { it } from '@runlith/effect-test';
import { describeThreadCompactionParent } from './compactionParent';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionParent('InMemory', openMemoryStorage, it.live);
