import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
import { type ProjectGroup, sharingOf } from '../../projects/contract/wire/project.js';
import { GroupLifecycle, RoutedGraphs } from '../contract/service/serving.js';
import { GROUP_OPERATIONS as OPS } from '../contract/wire/operations/groups.js';
import type { Group } from '../contract/wire/rows.js';
import { policies, wired } from './registry.js';

type In<K extends keyof typeof OPS> = (typeof OPS)[K]['input']['Type'];

const wiredGroups = Effect.fn('groups.wired')(function* (groups: readonly ProjectGroup[]) {
  const rows = yield* wired(yield* policies(groups.flatMap((group) => [group.graph, ...group.members])));
  let at = 0;
  return groups.map((group): Group => {
    const graph = rows[at]!;
    const members = rows.slice(at + 1, at + 1 + group.members.length);
    at += 1 + group.members.length;
    const sharing = group.members.map((member) => ({ project: member.id, ...sharingOf(group, member.id) }));
    return { graph, members, sharing };
  });
});

const wiredGroup = Effect.fn('groups.wiredOne')(function* (group: ProjectGroup) {
  const [only] = yield* wiredGroups([group]);
  if (only === undefined) return yield* Effect.die('a wired group answered no row');
  return only;
});

const groupNamed = Effect.fn('groups.named')(function* (ref: string) {
  const row = yield* (yield* Projects).named(ref);
  const group = yield* (yield* ProjectGroups).of(row.id);
  if (group !== undefined && group.graph.id === row.id) return group;
  return yield* new GateRefusal(
    'not-a-group',
    group === undefined ? `"${row.name}" is not a group` : `"${row.name}" is a member of the group "${group.graph.name}", not a group`,
    ['name the group by its name or id — list_groups names them', 'read_group names the group a project belongs to'],
  );
});

const projectNamed = Effect.fn('groups.project')(function* (ref: string) {
  return yield* (yield* Projects).named(ref);
});

export const GROUP_PAIRS = {
  list_groups: pair(
    OPS.list_groups,
    body(OPS.list_groups, {
      execute: Effect.fnUntraced(function* () {
        return { status: 'ok' as const, groups: yield* wiredGroups(yield* (yield* ProjectGroups).list()) };
      }),
    }),
  ),

  read_group: pair(
    OPS.read_group,
    body(OPS.read_group, {
      execute: Effect.fnUntraced(function* (input: In<'read_group'>) {
        const id = input.ref !== undefined ? (yield* projectNamed(input.ref)).id : (yield* yield* CurrentProject).project.id;
        const group = yield* (yield* ProjectGroups).of(id);
        return { status: 'ok' as const, group: group === undefined ? null : yield* wiredGroup(group) };
      }),
    }),
  ),

  make_group: pair(
    OPS.make_group,
    body(OPS.make_group, {
      execute: Effect.fnUntraced(function* (input: In<'make_group'>) {
        const members = yield* Effect.forEach(input.projects, (ref) => projectNamed(ref));
        const pool = yield* RoutedGraphs;
        const made = yield* (yield* GroupLifecycle).make(
          { name: input.name, members },
          pool === null ? undefined : (born) => pool.birth(born.id),
        );
        return { status: 'ok' as const, group: yield* wiredGroup(made.group), returned: made.returned };
      }),
    }),
  ),

  rename_group: pair(
    OPS.rename_group,
    body(OPS.rename_group, {
      execute: Effect.fnUntraced(function* (input: In<'rename_group'>) {
        const renamed = yield* (yield* GroupLifecycle).rename(yield* groupNamed(input.group), input.name);
        return { status: 'ok' as const, group: yield* wiredGroup(renamed) };
      }),
    }),
  ),

  join_group: pair(
    OPS.join_group,
    body(OPS.join_group, {
      execute: Effect.fnUntraced(function* (input: In<'join_group'>) {
        const joined = yield* (yield* GroupLifecycle).join(yield* groupNamed(input.group), yield* projectNamed(input.project));
        return { status: 'ok' as const, group: yield* wiredGroup(joined) };
      }),
    }),
  ),

  set_group_sharing: pair(
    OPS.set_group_sharing,
    body(OPS.set_group_sharing, {
      execute: Effect.fnUntraced(function* (input: In<'set_group_sharing'>) {
        const shared = yield* (yield* GroupLifecycle).share(yield* projectNamed(input.project), { gives: input.gives, takes: input.takes });
        return { status: 'ok' as const, group: yield* wiredGroup(shared) };
      }),
    }),
  ),

  leave_group: pair(
    OPS.leave_group,
    body(OPS.leave_group, {
      execute: Effect.fnUntraced(function* (input: In<'leave_group'>) {
        const left = yield* (yield* GroupLifecycle).leave(yield* projectNamed(input.project));
        const [project] = yield* wired(yield* policies([left.project]));
        if (project === undefined) return yield* Effect.die('a wired project answered no row');
        return { status: 'ok' as const, project, group: left.group === null ? null : yield* wiredGroup(left.group) };
      }),
    }),
  ),
};
