import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { groupSchema, projectSchema } from '../rows.js';
import { SURFACE_ACT, SURFACE_READ, graphInput } from './shared.js';

const project = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'A project, by name or id.' });
const group = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The group, by name or id.' });
const name = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The group’s name: it shares the namespace of project names and becomes the first segment of its graph’s addresses.',
});

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

const NAME_REFUSALS = ['reserved-project', 'project-name', 'duplicate-name'] as const;
const PROJECT_REFUSALS = ['not-found', 'unknown-project', 'ambiguous-project'] as const;

export const GROUP_OPERATIONS = {
  list_groups: operation('list_groups', {
    ...SURFACE_READ,
    place: 'machine',
    ...read('List the groups of projects?', 'Listed the groups'),
    meaning: 'List every group of projects this machine holds, each with its own registration and its members in order.',
    input: Schema.Struct({}),
    answer: arms({ ok: { groups: Schema.Array(groupSchema) } }),
    refusals: [],
  }),

  read_group: operation('read_group', {
    ...SURFACE_READ,
    place: 'project',
    ...read('Read this group?', 'Read a group'),
    meaning: 'Read the group a project belongs to, or a group by its own name or id.',
    grammar: 'Without `ref` it reads the group of the project the call stands in. A project in no group answers null.',
    input: graphInput({
      ref: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'A project or a group, by name or id.',
      }),
    }),
    answer: arms({ ok: { group: Schema.NullOr(groupSchema) } }),
    refusals: [...PROJECT_REFUSALS],
  }),

  make_group: operation('make_group', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Make a group of these projects?', 'Group', 'Made a group'),
    meaning:
      'Make a group of registered projects under one name: one system to Tagma, while each project keeps its own repository, graph, law and threads.',
    grammar:
      'The group is born with a graph of its own in Tagma’s data directory, stealth; its blocks carry no sources. A group dissolved under this name comes back with its graph and answers `returned`. The order of `projects` is the group’s order. A project belongs to at most one group, and neither the global project nor a group joins one.',
    input: Schema.Struct({
      name,
      projects: Schema.Array(project)
        .check(Schema.isMinLength(2))
        .annotate({ description: 'At least two distinct projects, in the group’s order.' }),
    }),
    answer: arms({ ok: { group: groupSchema, returned: Schema.Boolean } }),
    refusals: [...PROJECT_REFUSALS, ...NAME_REFUSALS, 'grouped', 'ungroupable', 'group-size', 'unwritable-root'],
  }),

  rename_group: operation('rename_group', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Rename this group?', 'Rename', 'Renamed a group'),
    meaning: 'Rename a group; its graph and members stay where they are.',
    input: Schema.Struct({ group, name }),
    answer: arms({ ok: { group: groupSchema } }),
    refusals: [...PROJECT_REFUSALS, ...NAME_REFUSALS, 'not-a-group', 'global-permanent'],
  }),

  join_group: operation('join_group', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Add this project to the group?', 'Add', 'Added a project to a group'),
    meaning: 'Add a registered project to a group, after its members.',
    input: Schema.Struct({ group, project }),
    answer: arms({ ok: { group: groupSchema } }),
    refusals: [...PROJECT_REFUSALS, 'not-a-group', 'grouped', 'ungroupable'],
  }),

  leave_group: operation('leave_group', {
    ...SURFACE_ACT,
    place: 'machine',
    ...act('Take this project out of its group?', 'Leave', 'A project left its group'),
    meaning: 'Take a project out of its group.',
    grammar:
      'A group left with one member dissolves: that member leaves too, and the answer’s `group` is null. The graph of a dissolved group stays on disk, and make_group under its name brings it back.',
    input: Schema.Struct({ project }),
    answer: arms({ ok: { project: projectSchema, group: Schema.NullOr(groupSchema) } }),
    refusals: [...PROJECT_REFUSALS, 'ungrouped'],
  }),
};
