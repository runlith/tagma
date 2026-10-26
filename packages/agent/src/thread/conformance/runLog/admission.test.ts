import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadAdmission } from './admission';

describeThreadAdmission('InMemory', openMemoryStorage, it.live);
