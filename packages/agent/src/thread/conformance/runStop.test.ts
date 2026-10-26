import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadRunStop } from './runStop';

describeThreadRunStop('InMemory', openMemoryStorage, it.live);
