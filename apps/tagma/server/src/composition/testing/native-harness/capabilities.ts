import { capabilityDefinitionsOf } from '../../../native-harness/testing/doubles.js';
import { CAPABILITIES } from '../composed.js';

export const servedCapabilities = () => capabilityDefinitionsOf(CAPABILITIES);
