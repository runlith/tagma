import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { DynamicOperationFailure } from './contract/service/refusals.js';

export const operationGateAt = (failure: DynamicOperationFailure): GateRefusal | null => (failure instanceof GateRefusal ? failure : null);
