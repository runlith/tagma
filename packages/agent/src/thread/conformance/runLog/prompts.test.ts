import { it } from '@runlith/effect-test';
import { openMemoryStorage } from '../memoryStorage';
import { describeThreadRunPrompts } from './prompts';

describeThreadRunPrompts('InMemory', openMemoryStorage, it.live);
