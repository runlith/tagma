import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunTakenBack } from './takenBack';

describeThreadRunTakenBack('InMemory', openMemoryStorage, it.live);
