import { Effect } from 'effect';
import { REGISTRY_OPERATIONS as OPS } from '../../graph/contract/wire/operations/registry.js';
import type { Project } from '../../graph/contract/wire/rows.js';
import type { Pointing } from '../../graph/contract/wire/far.js';
import type { ProjectRegistry } from '../../projects/contract/service/registration.js';
import { perform } from './perform.js';

type Removed = { readonly project: Project; readonly pointing: Pointing; readonly unlinked: number };

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
