import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunProcesses } from './processes';

describeThreadRunProcesses('InMemory', openMemoryStorage, it.live);
