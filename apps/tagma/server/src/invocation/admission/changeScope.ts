import { Effect } from 'effect';
import type { ChangeScope } from '../../change-record/contract/service/scope.js';
import type { CurrentProject } from '../../projects/contract/service/caller.js';

export const changeScopeOf = (current: CurrentProject['Service']): ChangeScope['Service'] => ({
  projectId: Effect.map(current, (call) => call.project.id),
});
