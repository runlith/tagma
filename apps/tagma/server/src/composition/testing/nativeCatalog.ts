import type { ToolCatalog } from '@runlith/agent/catalog';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { Context, Effect } from 'effect';
import { nativeCatalog } from '../../invocation/testing/native.js';
import type { NativeStanding } from '../../invocation/contract/service/nativeCall.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { CallerWorkspace } from '../../workspace/contract/service/places.js';
import type { CallWorld } from '../../invocation/contract/service/admission.js';
import type { WorkPlaces } from '../../threads/contract/service/working.js';
import type { ProjectRef } from '../../projects/contract/wire/project.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import type { CopyAim, ServedGraph } from '../../graph/contract/service/serving.js';
import { OperationChecks } from '../../invocation/contract/service/operationChecks.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { NO_RULES } from '../../enforcement/testing/doubles.js';
import { operationChecks } from '../operationChecks.js';
import { operationCatalog } from '../operationCatalog.js';
import { ASSEMBLY } from './composed.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { Git } from '@runlith/git/Git';
import { dirname, join } from 'node:path';
import { GraphStore } from '../../platform/contract/service/store.js';
import type { GraphUnits } from '../../platform/contract/service/units.js';
import { ServedGraphs, TaskHolders } from '../../graph/contract/service/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export const fixtureServedGraphs = (context: Context.Context<GraphServices | GraphStore | GraphUnits>): ServedGraphs['Service'] => {
  const treeRoot = dirname(Context.get(context, GraphStore).path);
  const unused = Effect.die('The native graph fixture serves its standing rows without creating or retiring graph trees.');
  const resolve = ({ projectId, cwd }: CopyAim) =>
    Context.get(context, Projects)
      .byId(projectId)
      .pipe(
        Effect.map((project) => ({
          context: Context.add(context, TaskHolders, { forHolders: () => Effect.succeed(new Map()) }),
          git: Context.get(context, Git),
          layout: {
            mode: 'stealth' as const,
            treeRoot,
            gitDir: join(treeRoot, '.git'),
            mirrorPath: Context.get(context, GraphStore).path,
          },
          projectId,
          checkout: cwd ?? project.rootPath,
          shadow: null,
          stealth: null,
          fresh: () => Effect.void,
          copyFailures: () => Effect.succeed([]),
          settled: () => Effect.void,
          dispose: () => Effect.void,
        })),
        Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['name a fixture project'])),
      );
  return ServedGraphs.of({
    resolve,
    hold: resolve,
    holdServed: () => unused,
    checkout: (aim) => Effect.map(resolve(aim), (served) => served.checkout),
    held: () => [],
    copies: { subscribe: () => () => {} },
    whileClosed: () => unused,
    titles: () => Effect.succeed({ titles: [], unreadable: [], unindexed: [] }),
    farStates: () => unused,
    farPointing: () => Effect.succeed({ pointers: [], unread: [] }),
    farOutgoing: () => unused,
    farWork: () => unused,
    graphRootOf: () => Effect.succeed({ kind: 'none' } as const),
    releaseProject: () => Effect.void,
    birth: () => unused,
    branches: () => unused,
    dispose: () => Effect.void,
    moveProjectStorage: () => unused,
    release: () => Effect.void,
  });
};

const unplaced = WorkingOrigins.of({
  of: () => Effect.succeed(null),
  rootOf: () => Effect.succeed(null),
  placeOf: () => Effect.succeed(null),
});

export const fixtureOperationCatalog = Effect.provide(operationCatalog(ASSEMBLY), approvalModesLayer);

export type FixtureNativeCall<Owners> = {
  readonly caller: Caller;
  readonly place: CallerWorkspace['Service'];
  readonly world: CallWorld['Service'];
  readonly standing?: NativeStanding;
  readonly places?: WorkPlaces['Service'];
  readonly project: ProjectRef;
  readonly vocabulary: () => TagTable;
  readonly identity: SessionIdentity['Service'];
  readonly graphRoot?: string;
  readonly owners: Context.Context<Owners | GraphServices>;
  readonly served?: ServedGraph;
  readonly refused?: GateRefusal;
};

export const fixtureNativeCatalog = Effect.fnUntraced(function* <Owners>(
  call: FixtureNativeCall<Owners>,
  ids: readonly string[],
): Effect.fn.Return<ToolCatalog> {
  const catalog = yield* fixtureOperationCatalog;
  return nativeCatalog(
    {
      ...call,
      catalog,
      owners: Effect.succeed(
        Context.merge(Context.make(OperationChecks, operationChecks(NO_RULES)), call.owners).pipe(
          Context.add(WorkingOrigins, Context.getOrUndefined(call.owners, WorkingOrigins) ?? unplaced),
          Context.add(SessionIdentity, call.identity),
        ),
      ),
    },
    ids,
  );
});
