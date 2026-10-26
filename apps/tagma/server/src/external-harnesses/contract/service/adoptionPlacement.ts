import type { Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootBinding } from '../../../workspace/contract/wire/roots.js';

export interface AdoptionPlacement {
  resolve(input: {
    readonly projectId: number;
    readonly rootId: RootId;
    readonly operationId: string;
    readonly name: string;
  }): Effect.Effect<RootBinding, GateRefusal>;
}
