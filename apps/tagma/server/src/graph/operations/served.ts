import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentGraph } from '../contract/service/serving.js';

export const served = Effect.gen(function* () {
  const current = yield* CurrentGraph;
  if (current === null) {
    return yield* new GateRefusal('graph-required', 'name the project or run inside a registered root', ['?project=<name|id>']);
  }
  return current;
});
