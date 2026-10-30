import { Clock, Effect, FileSystem, Ref } from 'effect';
import { and, asc, desc, eq, isNotNull, isNull, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { alias } from 'drizzle-orm/sqlite-core';
import { dataPathOf, MachineStore, storeDirectory, type StoreFailure } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../platform/contract/service/units.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { GroupChange } from './contract/service/changes.js';
import { ProjectGroups } from './contract/service/registry.js';
import type { DepartedGroup, NameRefusal, ProjectGroup, ProjectRow } from './contract/wire/project.js';
import { physical } from './identity.js';
import { registration } from './resolution.js';
import { groupMember, project } from './store/table.js';

const GROUPS_DIRECTORY = 'groups';

const member = alias(project, 'member');

const memberRow = {
  id: member.id,
  name: member.name,
  repoKey: member.repoKey,
  rootPath: member.rootPath,
  createdAt: member.createdAt,
  kind: member.kind,
};

const groupsIn = Effect.fn('ProjectGroups.read')(function* (store: MachineStore['Service'], unit: Unit<'machine'>) {
  const rows = yield* unit.run(
    store.db
      .select({ graph: registration, member: memberRow })
      .from(project)
      .leftJoin(groupMember, eq(groupMember.groupId, project.id))
      .leftJoin(member, eq(member.id, groupMember.projectId))
      .where(and(eq(project.kind, 'group'), isNull(project.removedAt)))
      .orderBy(asc(project.name), asc(project.id), asc(groupMember.ord)),
  );
  const groups: { readonly graph: ProjectRow; readonly members: ProjectRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const group = last?.graph.id === row.graph.id ? last : { graph: row.graph, members: [] };
    if (group !== last) groups.push(group);
    if (row.member !== null) group.members.push(row.member);
  }
  return groups as readonly ProjectGroup[];
});

type Standing = {
  readonly version: number;
  readonly groups: readonly ProjectGroup[];
  readonly byProject: ReadonlyMap<number, ProjectGroup>;
};

const indexed = (version: number, groups: readonly ProjectGroup[]): Standing => {
  const byProject = new Map<number, ProjectGroup>();
  for (const group of groups) {
    byProject.set(group.graph.id, group);
    for (const one of group.members) byProject.set(one.id, group);
  }
  return { version, groups, byProject };
};

const standingRow = (store: MachineStore['Service'], unit: Unit<'machine'>, id: number) =>
  unit.run(
    store.db
      .select(registration)
      .from(project)
      .where(and(eq(project.id, id), isNull(project.removedAt)))
      .get(),
  );

const holding = (groups: readonly ProjectGroup[], projectId: number) =>
  groups.find((group) => group.members.some((one) => one.id === projectId));

const ids = (members: readonly ProjectRow[]) => members.map((member) => member.id);

const enrolled = Effect.fnUntraced(function* (store: MachineStore['Service'], unit: Unit<'machine'>, asked: ProjectRow) {
  const row = yield* standingRow(store, unit, asked.id);
  if (row === undefined) {
    return yield* new GateRefusal('not-found', `project ${asked.id} ("${asked.name}") is no longer registered`, [
      'list_projects names the registered projects',
    ]);
  }
  if (row.kind === 'folder') return row;
  return yield* new GateRefusal(
    'ungroupable',
    row.kind === 'global'
      ? `"${row.name}" is the cross-project graph: its law already binds every project, so it joins no group`
      : `"${row.name}" is itself a group: a group joins no other`,
    ['group registered projects, each by its folder'],
  );
});

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
  const data = dataPathOf(store.path);
  const inMemory = data === null;
  const home = join(data ?? storeDirectory(store.path), GROUPS_DIRECTORY);

  const announced = (unit: WriteUnit<'machine'>, change: GroupChange) => unit.afterCommit(input.announce(change));

  let known: Standing | null = null;
  const standing = Effect.fnUntraced(function* () {
    const at = yield* Ref.get(input.version);
    if (known?.version === at) return known;
    const read = indexed(at, yield* units.read((unit) => groupsIn(store, unit)));
    if ((yield* Ref.get(input.version)) === at) known = read;
    return read;
  });

  const rootMade = (root: string) =>
    files
      .makeDirectory(root, { recursive: true })
      .pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal('unwritable-root', `the group's graph folder ${root} could not be made: ${failure.message}`, [
              "make Tagma's data directory writable, then make the group again",
            ]),
        ),
      );

  const born = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, name: string) {
    const key = randomUUID();
    const spelled = join(home, key);
    if (inMemory) return yield* insertGroup(unit, name, key, spelled);
    yield* rootMade(spelled);
    return yield* insertGroup(unit, name, key, yield* Effect.orDie(physical(files, spelled)));
  });

  const insertGroup = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, name: string, key: string, rootPath: string) {
    return yield* unit.run(
      db
        .insert(project)
        .values({ name, repoKey: `group:${key}`, rootPath, kind: 'group', createdAt: new Date(yield* Clock.currentTimeMillis) })
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
      return { from: group, rest: { graph: group.graph, members: rest } } satisfies DepartedGroup;
    }
    yield* unit.run(db.delete(groupMember).where(eq(groupMember.groupId, group.graph.id)));
    yield* unit.run(
      db
        .update(project)
        .set({ removedAt: new Date(yield* Clock.currentTimeMillis) })
        .where(eq(project.id, group.graph.id)),
    );
    yield* announced(unit, { groupId: group.graph.id, before: ids(group.members), after: [] });
    return { from: group, rest: null } satisfies DepartedGroup;
  });

  const discard = Effect.fn('ProjectGroups.discard')(function* (unit: WriteUnit<'machine'>, graph: ProjectRow) {
    const group = (yield* groupsIn(store, unit)).find((one) => one.graph.id === graph.id);
    if (group === undefined) return;
    yield* unit.run(db.delete(groupMember).where(eq(groupMember.groupId, graph.id)));
    yield* announced(unit, { groupId: graph.id, before: ids(group.members), after: [] });
  });

  const groups = ProjectGroups.of({
    list: () => Effect.map(standing(), (read) => read.groups),
    of: (projectId) => Effect.map(standing(), (read) => read.byProject.get(projectId)),
    form: Effect.fn('ProjectGroups.form')(function* (unit, { name, members: asked }) {
      if (asked.length < 2 || new Set(ids(asked)).size !== asked.length) {
        return yield* new GateRefusal('group-size', `a group is made of at least two distinct projects; ${asked.length} named`, [
          'name two or more different registered projects',
        ]);
      }
      const members = yield* Effect.forEach(asked, (one) => enrolled(store, unit, one));
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
      if (dissolved !== undefined && !inMemory) yield* rootMade(graph.rootPath);
      yield* unit.run(db.insert(groupMember).values(members.map((member, ord) => ({ projectId: member.id, groupId: graph.id, ord }))));
      yield* announced(unit, { groupId: graph.id, before: [], after: ids(members) });
      return { group: { graph, members }, returned: dissolved !== undefined };
    }),
    join: Effect.fn('ProjectGroups.join')(function* (unit, group, asked) {
      const row = yield* enrolled(store, unit, asked);
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
