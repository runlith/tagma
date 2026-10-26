import { it } from '@runlith/effect-test';
import { describeThreadHosting } from './hosting';
import { openMemoryStorage } from './memoryStorage';

describeThreadHosting('InMemory', openMemoryStorage, it.live);
