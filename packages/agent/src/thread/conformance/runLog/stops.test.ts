import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunStops } from './stops';

describeThreadRunStops('InMemory', openMemoryStorage, it.live);
