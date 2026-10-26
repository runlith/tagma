import { Context, type Effect } from 'effect';
import type { CallerRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectCaller } from '../wire/project.js';

export class CurrentProject extends Context.Service<CurrentProject, Effect.Effect<ProjectCaller, GateRefusal<CallerRefusal>>>()(
  'tagma/projects/CurrentProject',
) {
  declare readonly placeScoped: true;
}
