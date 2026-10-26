import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { BoundDeclaration, Refused } from '../../../platform/contract/service/body.js';

export type DynamicOperationFailure = Refused<BoundDeclaration>;

export const externalRefusal = (id: string, meaning: string): GateRefusal =>
  new GateRefusal('external-refused', `${id} is not offered to external callers: ${meaning}`, [
    'call an operation that names external callers, or call it as the operator',
  ]);
