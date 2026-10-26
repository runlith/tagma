import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunForeignStops } from './foreignStops';

describeThreadRunForeignStops('InMemory', openMemoryStorage, it.live);
