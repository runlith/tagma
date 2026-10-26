import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunTurns } from './turns';

describeThreadRunTurns('InMemory', openMemoryStorage, it.live);
