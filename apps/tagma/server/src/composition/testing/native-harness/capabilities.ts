import { capabilityDefinitionsOf } from '../../../native-harness/testing/doubles.js';
import { CAPABILITIES } from '../../manifest.js';

export const servedCapabilities = () => capabilityDefinitionsOf(CAPABILITIES);
