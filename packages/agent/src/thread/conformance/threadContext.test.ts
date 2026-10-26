import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadContext } from './threadContext';

describeThreadContext('InMemory', openMemoryStorage, it.live);
