import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadOpeningCost } from './openingCost';

describeThreadOpeningCost('InMemory', openMemoryStorage, it.live);
