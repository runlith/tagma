import { Effect } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { GateRefusal, OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { ActState } from '../contract/service/transaction.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
import { type MemberSharing, type ProjectRow, sharingOf } from '../../projects/contract/wire/project.js';
import { groupMember, project } from '../../projects/store/table.js';
import { Act } from '../contract/service/acts.js';
import { GroupLifecycle } from '../contract/service/serving.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { projectPolicy } from '../store/policy.js';
import { block, meta } from '../store/tables.js';
import { projecting, referencing } from '../store/actWrites.js';

const forming = writes('GroupLifecycle.make', [block, projectPolicy, meta], projecting, referencing);
const regrouping = writes('GroupLifecycle.regroup', []);

const said = (sharing: MemberSharing) => `gives ${sharing.gives.join(', ') || 'nothing'}; takes ${sharing.takes.join(', ') || 'nothing'}`;

export const makeGroupLifecycle = Effect.fnUntraced(function* (input: {
  readonly bear: (row: ProjectRow) => Effect.Effect<ProjectPolicyRow, StoreFailure | GateRefusal<OpenRefusal>, ActState>;
  readonly takeBack: (row: ProjectRow) => Effect.Effect<void, StoreFailure | GateRefusal>;
}) {
  const machine = yield* MachineStore;
  const act = yield* Act;
  const projects = yield* Projects;
  const groups = yield* ProjectGroups;

  const moved = (row: ProjectRow, from: number | null, to: number | null) =>
    act.record('project_set', null, { projectId: row.id, field: 'group', from, to });

  return GroupLifecycle.of({
    make: Effect.fn('GroupLifecycle.make')(function* ({ name, members }, birth) {
      const { formed, born } = yield* machine.transaction(writes('group.form', [project, groupMember, projectPolicy]), (unit) =>
        act.unit(
          forming,
          Effect.gen(function* () {
            const formed = yield* groups.form(unit, { name, members });
            const { graph } = formed.group;
            for (const member of formed.group.members) yield* moved(member, null, graph.id);
            if (formed.returned) {
              yield* act.record('project_return', null, { projectId: graph.id, repoKey: graph.repoKey, rootPath: graph.rootPath });
              return { formed, born: null };
            }
            return { formed, born: yield* input.bear(graph) };
          }),
        ),
      );
      if (born === null || birth === undefined) return formed;
      yield* birth(born).pipe(Effect.onError(() => Effect.orDie(input.takeBack(born))));
      return formed;
    }),

    rename: Effect.fn('GroupLifecycle.rename')(function* (group, name) {
      const graph = yield* machine.transaction(writes('group.rename', [project]), (unit) =>
        act.unit(
          regrouping,
          Effect.gen(function* () {
            const renamed = yield* projects.rename(unit, group.graph, name);
            if (renamed.name !== group.graph.name)
              yield* act.record('project_set', null, { projectId: renamed.id, field: 'name', from: group.graph.name, to: renamed.name });
            return renamed;
          }),
        ),
      );
      return { graph, members: group.members, sharing: group.sharing };
    }),

    join: Effect.fn('GroupLifecycle.join')(function* (group, row) {
      return yield* machine.transaction(writes('group.join', [groupMember]), (unit) =>
        act.unit(
          regrouping,
          Effect.gen(function* () {
            const joined = yield* groups.join(unit, group, row);
            yield* moved(row, null, joined.graph.id);
            return joined;
          }),
        ),
      );
    }),

    share: Effect.fn('GroupLifecycle.share')(function* (row, sharing) {
      return yield* machine.transaction(writes('group.share', [groupMember]), (unit) =>
        act.unit(
          regrouping,
          Effect.gen(function* () {
            const shared = yield* groups.share(unit, row, sharing);
            const to = sharingOf(shared.group, row.id);
            yield* act.record('project_set', null, { projectId: row.id, field: 'group-sharing', from: said(shared.from), to: said(to) });
            return shared.group;
          }),
        ),
      );
    }),

    leave: Effect.fn('GroupLifecycle.leave')(function* (row) {
      return yield* machine.transaction(writes('group.leave', [groupMember, project]), (unit) =>
        act.unit(
          regrouping,
          Effect.gen(function* () {
            const { from, rest } = yield* groups.leave(unit, row);
            for (const member of rest === null ? from.members : [row]) yield* moved(member, from.graph.id, null);
            if (rest === null)
              yield* act.record('project_remove', null, {
                projectId: from.graph.id,
                name: from.graph.name,
                repoKey: from.graph.repoKey,
                rootPath: from.graph.rootPath,
              });
            return { project: row, group: rest };
          }),
        ),
      );
    }),
  });
});
