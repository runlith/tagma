import { it } from '@runlith/effect-test';
import { describeThreadCompactionWithdrawals } from './compactionWithdrawals';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionWithdrawals('InMemory', openMemoryStorage, it.live);
