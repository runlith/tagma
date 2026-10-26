import { Effect } from 'effect';
import type { OpenRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProjectCall } from '../contract/wire/call.js';
import { GraphCall } from '../contract/service/serving.js';

export const projectOrNone: Effect.Effect<ProjectCall | undefined, GateRefusal<OpenRefusal>, GraphCall> = Effect.flatMap(
  GraphCall,
  (call) =>
    call.pipe(
      Effect.catchTag('GateRefusal', (refusal: GateRefusal<OpenRefusal>) =>
        refusal.code === 'project-required' ? Effect.succeed<ProjectCall | undefined>(undefined) : Effect.fail(refusal),
      ),
    ),
);
