import { describeRunTransitions } from './transitions';
import { openMemoryStorage } from './memoryStorage';

describeRunTransitions('memory', openMemoryStorage);
