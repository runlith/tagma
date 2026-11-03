import { Schema } from 'effect';
import type { Condition, Raised } from '@runlith/agent/permissions';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { blockSchema, projectBranchSchema, projectSchema } from '../rows.js';
import { STORAGE_MODES } from '../../../../projects/contract/wire/project.js';
import { pointingSchema } from '../far.js';
import { SURFACE_ACT, SURFACE_READ, noSubjects, graphInput } from './shared.js';

const PRIVATE_PROJECT: Condition = { id: 'private-project', label: 'Private project', asksFrom: 'review', timeout: 'none' };

const ref = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The project, by name or id.' });
const root = Schema.String.check(Schema.isMinLength(1));

const read = (summary: string, done: string) => ({
  confirmation: () => ({ summary }),
  confirmLabel: 'Read',
  presentation: { running: done, done },
  subjects: () => [],
});

const act = (summary: string, label: string, done: string) => ({
  confirmation: () => ({ summary }),
  confirmLabel: label,
  presentation: { running: done, done },
  subjects: () => [],
});

const ROOT_REFUSALS = ['relative-root', 'missing-root', 'unwritable-root', 'duplicate-root'] as const;

export const REGISTRY_OPERATIONS = {
  list_projects: operation('list_projects', {
    ...SURFACE_READ,
    place: 'machine',
    ...read('List the registered projects?', 'Listed the projects'),
    meaning: 'List every project this machine has registered, each with its policy and where its graph is served from.',
    input: Schema.Struct({}),
    answer: arms({ ok: { projects: Schema.Array(projectSchema) } }),
    refusals: ['not-found'],
  }),

  read_project: operation('read_project', {
    ...SURFACE_READ,
    place: 'project',
    ...read('Read this project?', 'Read a project'),
    meaning: 'Read one registered project by name or id, or the project the call stands in when no ref is named.',
    grammar: 'Without `ref` the answer is null where the call stands in no registered project.',
    input: graphInput({ ref: Schema.optional(ref) }),
    answer: arms({ ok: { project: Schema.NullOr(projectSchema), pointing: Schema.optional(pointingSchema) } }),
    refusals: ['not-found'],
  }),

  add_project: operation('add_project', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Register this project?', 'Register', 'Registered a project'),
    meaning: 'Register a checkout as a project: its graph is born and the commit gate is installed in it.',
    grammar:
      'A folder that is a removed project — the same folder, or its repository moved elsewhere — brings that project back with its id, name, policy, storage, graph and threads and answers `returned`, as does a registered repository added at the place it moved to; a removed project whose name another project took comes back under the name asked for. Otherwise the name, storage, policy, catalogs and contributed values asked for apply only to a project born here. A folder whose `.tagma` already holds a graph is added over that graph: team storage, and the catalogs that graph holds become the project’s own choice, so naming stealth or catalogs for it refuses `graph-carried`. A graph a creation step brings from elsewhere keeps its catalogs the same way. Another clone or a copy of a registered repository is a project of its own, and a worktree belongs to its repository’s project.',
    input: Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1)),
      rootPath: root,
      strictProvenance: Schema.optional(Schema.Boolean),
      private: Schema.optional(Schema.Boolean),
      storage: Schema.optional(Schema.Literals(STORAGE_MODES)).annotate({
        description: 'Where the graph files live. Omit to take team for a folder that carries its graph, stealth otherwise.',
      }),
      catalogs: Schema.optional(Schema.Array(Schema.String)).annotate({
        description:
          'The shipped catalogs a graph born empty is given, saved as the project’s own graph.catalogs choice. Omit to inherit the machine setting; an empty list installs the system library alone and no domain catalog.',
      }),
      contributed: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
        description:
          'Values for the creation steps this server’s modules contribute, keyed by step id. Each step takes its value after registration and before the graph first opens; a value it refuses, an id no step takes, or a step whose right this access lacks refuses the registration whole, naming the entry in `field`.',
      }),
    }),
    answer: arms({ ok: { project: projectSchema, returned: Schema.Boolean } }),
    refusals: [
      ...ROOT_REFUSALS,
      'reserved-project',
      'project-name',
      'duplicate-name',
      'unknown-catalog',
      'field-invalid',
      'right-missing',
      'graph-carried',
    ],
  }),

  read_folder: operation('read_folder', {
    ...SURFACE_READ,
    place: 'machine',
    ...read('Read what this folder holds?', 'Read a folder'),
    meaning: 'Read, before adding a folder, whether it carries its own graph and whether it is a git repository.',
    grammar:
      'The answer is about the folder’s project root: the top of its repository, or the folder itself without git. `carries` is true when its `.tagma` holds a block; add_project then adds the folder over that graph.',
    input: Schema.Struct({ rootPath: root }),
    answer: arms({ ok: { rootPath: Schema.String, carries: Schema.Boolean, git: Schema.Boolean } }),
    refusals: ['relative-root', 'missing-root', 'unwritable-root', 'graph-pool', 'git-refused', 'git-unreadable', 'git-incomplete'],
  }),

  set_project_root: operation('set_project_root', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Move this project to another checkout?', 'Move', 'Moved a project'),
    meaning: 'Point a registered project at another checkout; the commit gate is installed there.',
    input: Schema.Struct({ ref, rootPath: root }),
    answer: arms({ ok: { project: projectSchema } }),
    refusals: [...ROOT_REFUSALS, 'not-found', 'global-permanent', 'group-graph', 'git-refused', 'git-incomplete'],
  }),

  remove_project: operation('remove_project', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Remove this project from Tagma?', 'Remove', 'Removed a project'),
    intent: 'destructive',
    destructiveConsequence: () =>
      'The project leaves the list, its agents stop and its checkout loses the commit gate; nothing on disk is deleted.',
    meaning:
      'Take a project out of this machine’s list: its agents stop and the commit gate leaves its checkout, while its repository, graph, threads and settings stay — add_project with its folder brings it back.',
    grammar:
      'Edges other projects of this machine hold into its graph stay as they are, read as not on this machine, unless `unlink` removes each one by an unlink act in the graph holding it. The project leaves first: an unlink that refuses answers after the removal, and the edges left stand as not on this machine. Its name is free for another project to take.',
    input: Schema.Struct({
      ref,
      unlink: Schema.optional(Schema.Boolean).annotate({
        description: 'Once the project has left, unlink every edge another project of this machine holds into its graph.',
      }),
    }),
    answer: arms({ ok: { project: projectSchema, pointing: pointingSchema, unlinked: Schema.Number } }),
    refusals: ['not-found', 'global-permanent', 'group-graph', 'no-edge', 'operation-only', 'graph-pool'],
  }),

  update_project: operation('update_project', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Change this project?', 'Change', 'Changed a project'),
    meaning: 'Rename a registered project or switch its policies; what is not named stays as it is.',
    grammar:
      'A new name passes the checks a registration does and becomes the first segment of the project’s addresses; its graph, worktree copies, mirrors and threads stay where they are, because Tagma keeps them by the project’s id. The cross-project graph keeps its name.',
    input: Schema.Struct({
      ref,
      name: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      private: Schema.optional(Schema.Boolean),
      strictProvenance: Schema.optional(Schema.Boolean),
    }),
    answer: arms({ ok: { project: projectSchema } }),
    refusals: [
      'not-found',
      'unknown-project',
      'ambiguous-project',
      'global-permanent',
      'reserved-project',
      'project-name',
      'duplicate-name',
    ],
  }),

  set_project_storage: operation('set_project_storage', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Move this project’s graph to another storage?', 'Move', 'Moved a project’s storage'),
    meaning: 'Move a project’s block tree to another storage mode.',
    grammar:
      'To stealth, every block goes into the stealth tree, a team project’s stealth blocks under the parents they stand under. To team, every block goes into `.tagma` except the subtrees `keep` names: they stay stealth, with the stealth tree’s history, and a team block that depends on one of them refuses the move as `stealth-dependency` naming both.',
    input: Schema.Struct({
      ref,
      mode: Schema.Literals(STORAGE_MODES),
      keep: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))).annotate({
        description: 'With mode team: the blocks whose subtrees stay stealth, by name.',
      }),
    }),
    answer: arms({ ok: { project: projectSchema, treeRoot: Schema.String } }),
    subjects: noSubjects,
    raises: (_input: unknown, raised?: readonly Raised[]) => raised ?? [],
    approval: { ...ASKS_IN_REVIEW, when: [PRIVATE_PROJECT] },
    refusals: [
      'not-found',
      'no-pool',
      'storage-unchanged',
      'group-graph',
      'checkout-holds-tree',
      'detached-checkout',
      'tree-missing',
      'target-holds-tree',
      'storage-keep',
      'stealth-dependency',
      'stealth-supersede',
      'stealth-module',
      'bad-name',
      'ambiguous-name',
    ],
  }),

  list_branches: operation('list_branches', {
    ...SURFACE_READ,
    ...read('List the branches this project’s graph is served on?', 'Listed the branches'),
    meaning: 'List the branches the graph of the project the call names is served on.',
    input: graphInput({}),
    answer: arms({ ok: { branches: Schema.Array(projectBranchSchema) } }),
    refusals: [],
  }),

  list_root_blocks: operation('list_root_blocks', {
    ...SURFACE_READ,
    ...read('List this project’s root blocks?', 'Listed the root blocks'),
    meaning: 'List the blocks of the project the call names that have no parent.',
    input: graphInput({}),
    answer: arms({ ok: { blocks: Schema.Array(blockSchema), total: Schema.Int } }),
    refusals: [],
  }),
};
