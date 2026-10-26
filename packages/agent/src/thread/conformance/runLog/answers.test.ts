import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunAnswers } from './answers';

describeThreadRunAnswers('InMemory', openMemoryStorage, it.live);
