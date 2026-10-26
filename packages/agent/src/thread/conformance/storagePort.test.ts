import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadStoragePort } from './storagePort';

describeThreadStoragePort('InMemory', openMemoryStorage, it.live);
