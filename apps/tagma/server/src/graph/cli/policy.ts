import { Console, Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { PROJECT_SETTINGS } from '../contract/wire/storage.js';
import { STORAGE_MODES } from '../../projects/contract/wire/project.js';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { REGISTRY_OPERATIONS } from '../contract/wire/operations/registry.js';
import type { Group, Project } from '../contract/wire/rows.js';

export type PolicyCli = {
  readonly perform: Perform;
  readonly here: (at: Invocation) => DoorLens;
  readonly render: (rows: readonly Project[]) => string;
};

export const renderProjects = (rows: readonly Project[]): string =>
  rows
    .map(
      (row) =>
        `${row.name} (${row.id}) ${row.rootPath} ${row.kind === 'global' ? '[cross-project]' : row.kind === 'group' ? '[group]' : `[${row.repoKey}]`} [${row.storage}] [${row.servesFrom}]${row.strictProvenance ? ' [strict-provenance]' : ''}${row.private ? ' [private]' : ''}`,
    )
    .join('\n');

export const renderGroups = (groups: readonly Group[]): string =>
  groups.length === 0
    ? 'no groups'
    : groups
        .map(
          (group) =>
            `${group.graph.name} (${group.graph.id}): ${group.members.map((member) => `${member.name} (${member.id})`).join(', ')}`,
        )
        .join('\n');

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));

export const policy = ({ perform, here, render }: PolicyCli) => {
  const set = Command.make(
    'set',
    {
      json,
      ref: Argument.String('name|id'),
      setting: Argument.Literals('setting', PROJECT_SETTINGS),
      value: Argument.Literals('value', ['true', 'false'] as const),
    },
    ({ json, ref, setting, value }) =>
      Effect.gen(function* () {
        const { project: row } = yield* perform(
          REGISTRY_OPERATIONS.update_project,
          { ref, [setting]: value === 'true' },
          here(yield* CurrentInvocation),
        );
        if (json) return yield* print(row, true);
        yield* Console.log(render([row]));
      }),
  ).pipe(Command.withDescription(`change one setting of a registered project: ${PROJECT_SETTINGS.join(' | ')}, true or false`));

  const storage = Command.make(
    'storage',
    { json, ref: Argument.String('name|id'), mode: Argument.Literals('mode', STORAGE_MODES) },
    ({ json, ref, mode }) =>
      Effect.gen(function* () {
        const { status: _moved, ...moved } = yield* perform(
          REGISTRY_OPERATIONS.set_project_storage,
          { ref, mode },
          here(yield* CurrentInvocation),
        );
        if (json) return yield* print(moved, true);
        yield* Console.log(render([moved.project]));
        yield* Console.log(
          moved.project.storage === 'team'
            ? `tree: ${moved.treeRoot} — tracked by the project's own repository, and standing there uncommitted`
            : `tree: ${moved.treeRoot} — tracked by tagma`,
        );
      }),
  ).pipe(Command.withDescription(`move a project's graph to another storage: ${STORAGE_MODES.join(' | ')}`));

  return [set, storage] as const;
};
