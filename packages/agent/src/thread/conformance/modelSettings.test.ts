import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadModelSettings } from './modelSettings';

describeThreadModelSettings('InMemory', openMemoryStorage, it.live);
