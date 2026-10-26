import { describeRunTransitions } from '@runlith/agent/thread/conformance/transitions';
import { openThreadStorage } from '../storageHarness.js';

describeRunTransitions('SQLite', openThreadStorage);
