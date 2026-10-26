import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunContextChanges } from './contextChanges';

describeThreadRunContextChanges('InMemory', openMemoryStorage, it.live);
