import type { Context, Effect } from 'effect';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import type { ServedGraph } from '../../../graph/contract/service/serving.js';
import type { ProjectRef } from '../../../projects/contract/wire/project.js';
import type { TagTable } from '../../../graph/contract/wire/tags/table.js';
import type { CallerWorkspace, WorkingOrigins } from '../../../workspace/contract/service/places.js';
import type { ThreadWorld } from '../../../executions/contract/service/worlds.js';
import type { CallWorld } from './admission.js';
import type { OperationCatalog } from './catalog.js';
import type { OperationChecks } from './operationChecks.js';
import type { WorkPlaces } from '../../../threads/contract/service/working.js';

export type NativeStanding = {
  readonly world: ThreadWorld;
  readonly projectRoot: string;
};

export type NativeCall<Owners> = {
  readonly catalog: OperationCatalog['Service'];
  readonly caller: Caller;
  readonly place: CallerWorkspace['Service'];
  readonly world: CallWorld['Service'];
  readonly standing?: NativeStanding;
  readonly places?: WorkPlaces['Service'];
  readonly project: ProjectRef;
  readonly vocabulary: () => TagTable;
  readonly graphRoot?: string;
  readonly owners: Effect.Effect<Context.Context<GraphServices | OperationChecks | WorkingOrigins | Owners>, GateRefusal>;
  readonly served?: ServedGraph;
  readonly refused?: GateRefusal;
};
