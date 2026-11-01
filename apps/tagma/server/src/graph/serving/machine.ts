import { inArray } from 'drizzle-orm';
import { Context, Effect, Tracer } from 'effect';
import { MachineStore, type GraphStore } from '../../platform/contract/service/store.js';
import type { MachineUnits, GraphUnits } from '../../platform/contract/service/units.js';
import { block, meta } from '../store/tables.js';
import { project } from '../../projects/store/table.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import { type ActEntry, TreeGuard } from '../contract/service/acts.js';
import type { GraphServices } from '../contract/service/services.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { blocksOf } from '../journal/eventLog.js';
import { blocksRetiredKey } from '../contract/wire/storage.js';
import { CurrentGraph, GroupLifecycle, ProjectLifecycle, ProjectPolicy } from '../contract/service/serving.js';
import { writes } from '../../platform/contract/service/writes.js';

const retiring = writes('TreeGuard.retirement', []);

export type MachineContext = Context.Context<GraphServices | GraphStore | GraphUnits | MachineStore | MachineUnits>;

export function machineRetirementGate(
  store: Context.Service.Shape<typeof MachineStore>,
): NonNullable<Context.Service.Shape<typeof TreeGuard>> {
  const guard: NonNullable<Context.Service.Shape<typeof TreeGuard>>['guard'] = (act) => act;
  const write = Effect.fnUntraced(function* (entries: readonly ActEntry[]) {
    const touched = [...new Set(entries.flatMap((entry) => blocksOf(entry).ids))];
    if (touched.length === 0) return;
    const rows = yield* store.db.select({ projectId: block.projectId }).from(block).where(inArray(block.id, touched));
    const projects = [...new Set(rows.map((row) => row.projectId))];
    if (projects.length === 0) return;
    const markers = yield* store.db
      .select({ key: meta.key })
      .from(meta)
      .where(
        inArray(
          meta.key,
          projects.map((id) => blocksRetiredKey(id)),
        ),
      );
    if (markers.length === 0) return;
    const retired = new Set(markers.map((row) => row.key));
    const named = yield* store.db
      .select({ id: project.id, name: project.name, rootPath: project.rootPath })
      .from(project)
      .where(inArray(project.id, projects));
    const reached = named.filter((row) => retired.has(blocksRetiredKey(row.id)));
    const names = reached.length > 0 ? reached.map((row) => `"${row.name}"`) : projects.map((id) => `project ${id}`);
    const caller = yield* CallerAim;
    const aim =
      caller === null
        ? 'carried no aim'
        : caller.project !== undefined
          ? `named project "${caller.project}"`
          : caller.cwd !== undefined
            ? `stood in ${caller.cwd}, which is inside no registered root`
            : 'named no project and carried no cwd';
    const first = reached[0];
    return yield* new GateRefusal(
      'project-retired',
      `${names.join(', ')} ${reached.length > 1 ? 'serve' : 'serves'} from files now, and this call ${aim}, so it was not routed to that graph and reached the retired machine rows`,
      [
        first === undefined
          ? 'send `project` on the call, so the door routes it to the served graph'
          : `send \`project=${first.name}\` on the call, or stand inside ${first.rootPath}`,
        'tagma project list — the registered roots, and where each project’s blocks answer from',
      ],
    );
  }, Effect.as(Effect.void));
  return { guard, prepare: Effect.succeed({ write, undo: Effect.void }), writes: retiring };
}

export const withoutRegistry = Context.omit(ProjectPolicy, ProjectLifecycle, GroupLifecycle);

export const machineGraphOf = <R>(
  context: Context.Context<R | MachineStore | ProjectLifecycle | ProjectPolicy | GroupLifecycle>,
): Context.Context<R | MachineStore | ProjectLifecycle | ProjectPolicy | GroupLifecycle> => {
  const lifecycle = Context.get(context, ProjectLifecycle);
  const policy = Context.get(context, ProjectPolicy);
  const groups = Context.get(context, GroupLifecycle);
  const within = <A, E, X>(effect: Effect.Effect<A, E, X>): Effect.Effect<A, E, X> => Effect.provide(effect, bound);
  const graph = Context.add(context, TreeGuard, machineRetirementGate(Context.get(context, MachineStore))).pipe(
    Context.add(
      ProjectLifecycle,
      ProjectLifecycle.of({
        create: (input, birth) => within(lifecycle.create(input, birth)),
        move: (projectId, root) => within(lifecycle.move(projectId, root)),
        update: (input) => within(lifecycle.update(input)),
        remove: (input) => within(lifecycle.remove(input)),
      }),
    ),
    Context.add(
      ProjectPolicy,
      ProjectPolicy.of({
        read: (ids) => within(policy.read(ids)),
        set: (input) => within(policy.set(input)),
        setStorage: (input) => within(policy.setStorage(input)),
        servesFrom: (ids) => within(policy.servesFrom(ids)),
        subscribe: policy.subscribe,
      }),
    ),
    Context.add(
      GroupLifecycle,
      GroupLifecycle.of({
        make: (input, birth) => within(groups.make(input, birth)),
        rename: (group, name) => within(groups.rename(group, name)),
        join: (group, project) => within(groups.join(group, project)),
        leave: (project) => within(groups.leave(project)),
      }),
    ),
  );
  const bound: Context.Context<never> = Context.add(Context.omit(Tracer.ParentSpan)(graph), CurrentGraph, null);
  return graph;
};
