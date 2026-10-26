import { it } from '@runlith/effect-test';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadSpawnBirth } from './spawnBirth';

describeThreadSpawnBirth('InMemory', openMemoryStorage, it.live);
