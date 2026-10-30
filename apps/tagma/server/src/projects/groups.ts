import { Clock, Effect, FileSystem, Ref } from 'effect';
import { and, asc, desc, eq, isNotNull, isNull, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MachineStore, storeDirectory, type StoreFailure } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../platform/contract/service/units.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { GroupChange } from './contract/service/changes.js';
import { ProjectGroups } from './contract/service/registry.js';
import type { NameRefusal, ProjectGroup, ProjectRow } from './contract/wire/project.js';
import { physical } from './identity.js';
import { registration } from './resolution.js';
import { groupMember, project } from './store/table.js';

const GROUPS_DIRECTORY = 'groups';

const groupsIn = Effect.fn('ProjectGroups.read')(function* (store: MachineStore['Service'], unit: Unit<'machine'>) {
  const graphs = yield* unit.run(
    store.db
      .select(registration)
      .from(project)
      .where(and(eq(project.kind, 'group'), isNull(project.removedAt)))
      .orderBy(asc(project.name)),
  );
  if (graphs.length === 0) return [];
  const rows = yield* unit.run(
    store.db
      .select({ ...registration, groupId: groupMember.groupId })
      .from(groupMember)
      .innerJoin(project, eq(project.id, groupMember.projectId))
      .orderBy(asc(groupMember.groupId), asc(groupMember.ord)),
  );
  const members = new Map<number, ProjectRow[]>();
  for (const { groupId, ...member } of rows) members.set(groupId, [...(members.get(groupId) ?? []), member]);
  return graphs.map((graph): ProjectGroup => ({ graph, members: members.get(graph.id) ?? [] }));
});

const holding = (groups: readonly ProjectGroup[], projectId: number) =>
  groups.find((group) => group.members.some((one) => one.id === projectId));

const ids = (members: readonly ProjectRow[]) => members.map((member) => member.id);

const ungroupable = (row: ProjectRow) =>
  row.kind === 'folder'
    ? Effect.void
    : new GateRefusal(
        'ungroupable',
        row.kind === 'global'
          ? `"${row.name}" is the cross-project graph: its law already binds every project, so it joins no group`
          : `"${row.name}" is itself a group: a group joins no other`,
        ['group registered projects, each by its folder'],
      );

const grouped = (row: ProjectRow, group: ProjectGroup) =>
  new GateRefusal('grouped', `"${row.name}" already belongs to the group "${group.graph.name}"`, [
    `leave_group "${row.name}" first — a project belongs to one group at a time`,
  ]);

export const makeGroups = Effect.fnUntraced(function* (input: {
  readonly version: Ref.Ref<number>;
  readonly named: (unit: Unit<'machine'>, name: string) => Effect.Effect<void, StoreFailure | GateRefusal<NameRefusal>>;
  readonly announce: (change: GroupChange) => Effect.Effect<void>;
}) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const { db } = store;
  const home = join(storeDirectory(store.path), GROUPS_DIRECTORY);

  const announced = (unit: WriteUnit<'machine'>, change: GroupChange) => unit.afterCommit(input.announce(change));

  let known: { readonly version: number; readonly groups: readonly ProjectGroup[] } | null = null;
  const standing = Effect.fnUntraced(function* () {
    const at = yield* Ref.get(input.version);
    if (known?.version === at) return known.groups;
    const groups = yield* units.read((unit) => groupsIn(store, unit));
    if ((yield* Ref.get(input.version)) === at) known = { version: at, groups };
    return groups;
  });

  const rootOf = (key: string) => {
    const spelled = join(home, key);
    return physical(files, spelled).pipe(
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(
          Effect.logWarning('a group root keeps the spelling it was named by: its physical path could not be read', {
            reason: failure.message,
          }),
          spelled,
        ),
      ),
    );
  };

  const born = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, name: string) {
    const key = randomUUID();
    return yield* unit.run(
      db
        .insert(project)
        .values({
          name,
          repoKey: `group:${key}`,
          rootPath: yield* rootOf(key),
          kind: 'group',
          createdAt: new Date(yield* Clock.currentTimeMillis),
        })
        .returning(registration)
        .get(),
    );
  });

  const depart = Effect.fn('ProjectGroups.depart')(function* (unit: WriteUnit<'machine'>, row: ProjectRow) {
    const group = holding(yield* groupsIn(store, unit), row.id);
    if (group === undefined) return undefined;
    const rest = group.members.filter((member) => member.id !== row.id);
    if (rest.length >= 2) {
      yield* unit.run(db.delete(groupMember).where(eq(groupMember.projectId, row.id)));
      yield* announced(unit, { groupId: group.graph.id, before: ids(group.members), after: ids(rest) });
      return { graph: group.graph, members: rest } satisfies ProjectGroup;
    }
    yield* unit.run(db.delete(groupMember).where(eq(groupMember.groupId, group.graph.id)));
    yield* unit.run(
      db
        .update(project)
        .set({ removedAt: new Date(yield* Clock.currentTimeMillis) })
        .where(eq(project.id, group.graph.id)),
    );
    yield* announced(unit, { groupId: group.graph.id, before: ids(group.members), after: [] });
    return null;
  });

  const discard = Effect.fn('ProjectGroups.discard')(function* (unit: WriteUnit<'machine'>, graph: ProjectRow) {
    const group = (yield* groupsIn(store, unit)).find((one) => one.graph.id === graph.id);
    if (group === undefined) return;
    yield* unit.run(db.delete(groupMember).where(eq(groupMember.groupId, graph.id)));
    yield* announced(unit, { groupId: graph.id, before: ids(group.members), after: [] });
  });

  const groups = ProjectGroups.of({
    list: standing,
    of: Effect.fnUntraced(function* (projectId) {
      return (yield* standing()).find((group) => group.graph.id === projectId || group.members.some((one) => one.id === projectId));
    }),
    form: Effect.fn('ProjectGroups.form')(function* (unit, { name, members }) {
      if (members.length < 2 || new Set(ids(members)).size !== members.length) {
        return yield* new GateRefusal('group-size', `a group is made of at least two distinct projects; ${members.length} named`, [
          'name two or more different registered projects',
        ]);
      }
      for (const member of members) yield* ungroupable(member);
      const groups = yield* groupsIn(store, unit);
      for (const member of members) {
        const held = holding(groups, member.id);
        if (held !== undefined) return yield* grouped(member, held);
      }
      yield* input.named(unit, name);
      const dissolved = yield* unit.run(
        db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.kind, 'group'), eq(project.name, name), isNotNull(project.removedAt)))
          .orderBy(desc(project.id))
          .get(),
      );
      const graph =
        dissolved === undefined
          ? yield* born(unit, name)
          : yield* unit.run(db.update(project).set({ removedAt: null }).where(eq(project.id, dissolved.id)).returning(registration).get());
      if (graph === undefined) return yield* Effect.die('group registration returned no row');
      yield* unit.run(db.insert(groupMember).values(members.map((member, ord) => ({ projectId: member.id, groupId: graph.id, ord }))));
      yield* announced(unit, { groupId: graph.id, before: [], after: ids(members) });
      return { group: { graph, members }, returned: dissolved !== undefined };
    }),
    join: Effect.fn('ProjectGroups.join')(function* (unit, group, row) {
      yield* ungroupable(row);
      const groups = yield* groupsIn(store, unit);
      const current = groups.find((one) => one.graph.id === group.graph.id);
      if (current === undefined) {
        return yield* new GateRefusal('not-a-group', `"${group.graph.name}" is no longer a group`, ['list_groups names the groups']);
      }
      const held = holding(groups, row.id);
      if (held !== undefined) return yield* grouped(row, held);
      const top = yield* unit.run(
        db
          .select({ ord: max(groupMember.ord) })
          .from(groupMember)
          .where(eq(groupMember.groupId, current.graph.id))
          .get(),
      );
      yield* unit.run(db.insert(groupMember).values({ projectId: row.id, groupId: current.graph.id, ord: (top?.ord ?? -1) + 1 }));
      const members = [...current.members, row];
      yield* announced(unit, { groupId: current.graph.id, before: ids(current.members), after: ids(members) });
      return { graph: current.graph, members };
    }),
    leave: Effect.fn('ProjectGroups.leave')(function* (unit, row) {
      const left = yield* depart(unit, row);
      if (left === undefined) {
        return yield* new GateRefusal('ungrouped', `"${row.name}" belongs to no group`, ['list_groups names the groups and their members']);
      }
      return left;
    }),
  });

  return { groups, depart, discard };
});
