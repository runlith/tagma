import { it } from '@runlith/effect-test';
import { describeThreadCompactionRequests } from './compactionRequests';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionRequests('InMemory', openMemoryStorage, it.live);
