import { Context, type Effect } from 'effect';
import type { CallerRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';

export class ChangeScope extends Context.Service<
  ChangeScope,
  {
    readonly projectId: Effect.Effect<number, GateRefusal<CallerRefusal>>;
  }
>()('tagma/change-record/ChangeScope') {}
