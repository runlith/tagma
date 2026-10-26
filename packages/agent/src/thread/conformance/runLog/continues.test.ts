import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunContinues } from './continues';

describeThreadRunContinues('InMemory', openMemoryStorage, it.live);
