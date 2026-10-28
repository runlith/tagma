import type { Raised } from '@runlith/agent/permissions';
import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Selection } from '../contract/service/reads.js';
import { RegisteredRoots } from '../contract/service/registeredRoots.js';
import { GraphCall, ProjectLifecycle, ProjectPolicy, RoutedGraphs } from '../contract/service/serving.js';
import { GraphRemotes } from '../contract/service/remote.js';
import { remoteRefusal } from '../contract/wire/remote.js';
import { REGISTRY_OPERATIONS as OPS } from '../contract/wire/operations/registry.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { wireBlock, wireProject } from '../reading/rows.js';
import { pointingInto } from '../acts/far.js';
import type { FarPointer } from '../contract/service/foreign.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { BlockNames } from '../contract/service/acts.js';
import { Edges } from '../contract/service/blocks.js';

type In<K extends keyof typeof OPS> = (typeof OPS)[K]['input']['Type'];

const dependencies = Effect.map(Behaviours, (behaviours) => behaviours.edges.filter((edge) => edge.meaning === 'dependency'));

const wired = Effect.fn('registry.wired')(function* (rows: readonly ProjectPolicyRow[]) {
  const serving = yield* (yield* ProjectPolicy).servesFrom(rows.map((row) => row.id));
  return rows.map((row) => wireProject(row, serving.get(row.id) ?? 'rows'));
});

const wiredOne = Effect.fn('registry.wiredOne')(function* (row: ProjectPolicyRow) {
  const [only] = yield* wired([row]);
  if (only === undefined) return yield* Effect.die('a wired project answered no row');
  return only;
});

const policies = Effect.fn('registry.policies')(function* (rows: readonly ProjectRow[]) {
  const found = yield* (yield* ProjectPolicy).read(rows.map((row) => row.id));
  return yield* Effect.forEach(rows, (row) => {
    const policy = found.get(row.id);
    return policy === undefined
      ? new GateRefusal('not-found', `project ${row.id} is not in this store's registry`, ['read the project registry again'])
      : Effect.succeed(policy);
  });
});

const registered = (row: ProjectRow) => Effect.flatMap(policies([row]), (rows) => wiredOne(rows[0]!));

const resolved = Effect.fn('registry.resolved')(function* (ref: string) {
  return yield* (yield* Projects).named(ref);
});

export const REGISTRY_PAIRS = {
  list_projects: pair(
    OPS.list_projects,
    body(OPS.list_projects, {
      execute: Effect.fnUntraced(function* () {
        const projects = yield* wired(yield* policies(yield* (yield* Projects).list()));
        return { status: 'ok' as const, projects };
      }),
    }),
  ),

  read_project: pair(
    OPS.read_project,
    body(OPS.read_project, {
      execute: Effect.fnUntraced(function* (input: In<'read_project'>) {
        const current =
          input.ref !== undefined
            ? null
            : yield* (yield* CurrentProject).pipe(
                Effect.map((call) => call.project.id),
                Effect.catchIf(
                  (refusal) => refusal.code === 'project-required',
                  () => Effect.succeed(null),
                ),
              );
        const row = input.ref !== undefined ? yield* resolved(input.ref) : current === null ? null : yield* (yield* Projects).byId(current);
        if (row === null) return { status: 'ok' as const, project: null };
        const pointing = (yield* pointingInto(row.id, yield* dependencies)).summary;
        return { status: 'ok' as const, project: yield* registered(row), pointing };
      }),
    }),
  ),

  add_project: pair(
    OPS.add_project,
    body(OPS.add_project, {
      execute: Effect.fnUntraced(function* (input: In<'add_project'>) {
        const refusal = input.graphRemote === undefined ? null : remoteRefusal(input.graphRemote);
        if (refusal !== null) return yield* refusal;
        const pool = yield* RoutedGraphs;
        const row = yield* (yield* ProjectLifecycle).create({ ...input }, pool === null ? undefined : (born) => pool.birth(born.id));
        yield* (yield* RegisteredRoots).joined(row.rootPath);
        return { status: 'ok' as const, project: yield* wiredOne(row), returned: row.returned };
      }),
    }),
  ),

  set_project_root: pair(
    OPS.set_project_root,
    body(OPS.set_project_root, {
      execute: Effect.fnUntraced(function* (input: In<'set_project_root'>) {
        const current = yield* resolved(input.ref);
        const row = yield* (yield* ProjectLifecycle).move(current.id, input.rootPath);
        yield* (yield* RegisteredRoots).joined(row.rootPath);
        return { status: 'ok' as const, project: yield* wiredOne(row) };
      }),
    }),
  ),

  remove_project: pair(
    OPS.remove_project,
    body(OPS.remove_project, {
      execute: Effect.fnUntraced(function* (input: In<'remove_project'>) {
        const leaving = yield* resolved(input.ref);
        const into = yield* pointingInto(leaving.id, yield* dependencies);
        const row = yield* admitted(OPS.remove_project)((yield* ProjectLifecycle).remove({ ref: input.ref }));
        const others = (yield* (yield* Projects).list()).flatMap((one) => (one.global ? [] : [one.rootPath]));
        yield* (yield* RegisteredRoots).left(row.rootPath, others);
        const pool = yield* RoutedGraphs;
        let unlinked = 0;
        if (input.unlink === true && pool !== null) {
          const bySource = new Map<number, Map<string, FarPointer[]>>();
          for (const pointer of into.pointers) {
            const held = bySource.get(pointer.project.id) ?? new Map<string, FarPointer[]>();
            const key = `${pointer.from}\u0000${pointer.kind}`;
            const group = held.get(key);
            if (group === undefined) held.set(key, [pointer]);
            else group.push(pointer);
            bySource.set(pointer.project.id, held);
          }
          for (const [projectId, held] of bySource) {
            const served = yield* pool.resolve({ projectId });
            for (const group of held.values()) {
              const first = group[0]!;
              yield* Effect.provide(
                Effect.gen(function* () {
                  const fromId = yield* (yield* BlockNames).idOfName(first.from.replaceAll('-', ''));
                  yield* (yield* Edges).unlinkFar({
                    fromId,
                    kind: first.kind,
                    to: group.map((one) => ({ graph: one.graph, uuid: one.to })),
                  });
                }),
                served.context,
              );
              unlinked += group.length;
            }
          }
        }
        return { status: 'ok' as const, project: yield* wiredOne(row), pointing: into.summary, unlinked };
      }),
    }),
  ),

  update_project: pair(
    OPS.update_project,
    body(OPS.update_project, {
      execute: Effect.fnUntraced(function* (input: In<'update_project'>) {
        const row = yield* (yield* ProjectLifecycle).update({
          ref: input.ref,
          name: input.name,
          settings: { private: input.private, strictProvenance: input.strictProvenance },
        });
        return { status: 'ok' as const, project: yield* wiredOne(row) };
      }),
    }),
  ),

  set_project_storage: pair(
    OPS.set_project_storage,
    body(OPS.set_project_storage, {
      prepare: Effect.fn('set_project_storage.terms')(function* (input: In<'set_project_storage'>) {
        const row = yield* resolved(input.ref);
        const policy = (yield* (yield* ProjectPolicy).read([row.id])).get(row.id);
        const consents: readonly Raised[] =
          input.mode === 'team' && policy?.private === true
            ? [
                {
                  condition: 'private-project',
                  fact: `"${row.name}" is registered private; team storage writes its graph into the checkout and clears private`,
                },
              ]
            : [];
        return consents;
      }),
      execute: Effect.fnUntraced(function* (input: In<'set_project_storage'>, consents: readonly Raised[]) {
        const row = yield* resolved(input.ref);
        if (consents.length > 0) yield* (yield* ProjectPolicy).set({ ref: input.ref, settings: { private: false } });
        const pool = yield* RoutedGraphs;
        if (pool === null) {
          return yield* new GateRefusal('no-pool', 'this door serves no graphs, so none can be moved', [
            'run the move against the tagma server, which holds the graphs it would move',
          ]);
        }
        const moved = yield* pool.moveProjectStorage({ projectId: row.id, mode: input.mode, keep: input.keep });
        return { status: 'ok' as const, project: yield* wiredOne(moved.row), treeRoot: moved.treeRoot };
      }),
    }),
  ),

  set_graph_remote: pair(
    OPS.set_graph_remote,
    body(OPS.set_graph_remote, {
      prepare: Effect.fn('set_graph_remote.terms')(function* (input: In<'set_graph_remote'>) {
        const row = yield* resolved(input.ref);
        const consents: readonly Raised[] =
          input.restore === true
            ? [
                {
                  condition: 'graph-set-aside',
                  fact: `"${row.name}"'s graph on this machine is set aside, and the graph ${input.remote ?? 'the remote'} holds is served in its place`,
                },
              ]
            : [];
        return consents;
      }),
      execute: Effect.fnUntraced(function* (input: In<'set_graph_remote'>) {
        const row = yield* resolved(input.ref);
        if ((yield* RoutedGraphs) === null) {
          return yield* new GateRefusal('no-pool', 'this door serves no graphs, so none can exchange with a remote', [
            'run it against the tagma server, which holds the graphs',
          ]);
        }
        const set = yield* (yield* GraphRemotes).set({ projectId: row.id, remote: input.remote, restore: input.restore === true });
        return { status: 'ok' as const, project: yield* wiredOne(set.row), remote: set.remote, setAside: set.setAside };
      }),
    }),
  ),

  read_graph_remote: pair(
    OPS.read_graph_remote,
    body(OPS.read_graph_remote, {
      execute: Effect.fnUntraced(function* (input: In<'read_graph_remote'>) {
        const row = input.ref !== undefined ? yield* resolved(input.ref) : (yield* yield* CurrentProject).project;
        if ((yield* RoutedGraphs) === null) {
          return yield* new GateRefusal('no-pool', 'this door serves no graphs, so it knows no graph remote', [
            'run it against the tagma server, which holds the graphs',
          ]);
        }
        const remote = yield* (yield* GraphRemotes).read(row.id);
        return { status: 'ok' as const, project: yield* registered(yield* (yield* Projects).byId(row.id)), remote };
      }),
    }),
  ),

  list_branches: pair(
    OPS.list_branches,
    body(OPS.list_branches, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const pool = yield* RoutedGraphs;
        return { status: 'ok' as const, branches: pool === null ? [] : yield* pool.branches(call.project.id) };
      }),
    }),
  ),

  list_root_blocks: pair(
    OPS.list_root_blocks,
    body(OPS.list_root_blocks, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const blocks = (yield* (yield* Selection).roots(call.project.id)).map(wireBlock);
        return { status: 'ok' as const, blocks, total: blocks.length };
      }),
    }),
  ),
};
