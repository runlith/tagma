import { it } from '@runlith/effect-test';
import { describeHostedCalls } from './hostedCalls';
import { describeHostedTools } from './hostedTools';
import { openMemoryStorage } from './memoryStorage';

describeHostedCalls('InMemory', openMemoryStorage, it.live);
describeHostedTools('InMemory', openMemoryStorage, it.live);
