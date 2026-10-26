import { it } from '@runlith/effect-test';
import { describeThreadCompactionTasks } from './compactionParent';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionTasks('InMemory', openMemoryStorage, it.live);
