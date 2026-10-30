import { Effect } from 'effect';
import { REGISTRY_OPERATIONS as OPS } from '../../graph/contract/wire/operations/registry.js';
import { GROUP_OPERATIONS as GROUPS } from '../../graph/contract/wire/operations/groups.js';
import type { Group, Project } from '../../graph/contract/wire/rows.js';
import type { Pointing } from '../../graph/contract/wire/far.js';
import type { GroupRegistry, ProjectRegistry } from '../../projects/contract/service/registration.js';
import { perform } from './perform.js';

type Removed = { readonly project: Project; readonly pointing: Pointing; readonly unlinked: number };

type Left = { readonly project: Project; readonly group: Group | null };

export const groupRegistry: GroupRegistry<Group, Left> = {
  make: (input, lens) => Effect.map(perform(GROUPS.make_group, input, lens), (answer) => answer.group),
  rename: (group, name, lens) => Effect.map(perform(GROUPS.rename_group, { group, name }, lens), (answer) => answer.group),
  join: (group, project, lens) => Effect.map(perform(GROUPS.join_group, { group, project }, lens), (answer) => answer.group),
  leave: (project, lens) =>
    Effect.map(perform(GROUPS.leave_group, { project }, lens), (answer) => ({ project: answer.project, group: answer.group })),
  list: (lens) => Effect.map(perform(GROUPS.list_groups, {}, lens), (answer) => answer.groups),
  read: (ref, lens) => Effect.map(perform(GROUPS.read_group, { ref }, lens), (answer) => answer.group),
};

export const projectRegistry: ProjectRegistry<Project, Removed> = {
  add: (input, lens) => Effect.map(perform(OPS.add_project, input, lens), (answer) => answer.project),
  move: (ref, rootPath, lens) => Effect.map(perform(OPS.set_project_root, { ref, rootPath }, lens), (answer) => answer.project),
  remove: (input, lens) =>
    Effect.map(perform(OPS.remove_project, input, lens), (answer) => ({
      project: answer.project,
      pointing: answer.pointing,
      unlinked: answer.unlinked,
    })),
  list: (lens) => Effect.map(perform(OPS.list_projects, {}, lens), (answer) => answer.projects),
  read: (ref, lens) =>
    Effect.flatMap(perform(OPS.read_project, { ref }, lens), (answer) =>
      answer.project === null ? Effect.die(`read_project answered no project for ${ref}`) : Effect.succeed(answer.project),
    ),
};
