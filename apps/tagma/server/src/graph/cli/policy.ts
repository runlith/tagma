import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { GraphRemote } from '../contract/wire/remote.js';
import { PROJECT_SETTINGS } from '../contract/wire/storage.js';
import { STORAGE_MODES } from '../../projects/contract/wire/project.js';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { REGISTRY_OPERATIONS } from '../contract/wire/operations/registry.js';
import type { Project } from '../contract/wire/rows.js';

export type PolicyCli = {
  readonly perform: Perform;
  readonly here: (at: Invocation) => DoorLens;
  readonly render: (rows: readonly Project[]) => string;
};

export const renderProjects = (rows: readonly Project[]): string =>
  rows
    .map(
      (row) =>
        `${row.name} (${row.id}) ${row.rootPath} ${row.global ? '[cross-project]' : `[${row.repoKey}]`} [${row.storage}] [${row.servesFrom}]${row.strictProvenance ? ' [strict-provenance]' : ''}${row.private ? ' [private]' : ''}${row.graphRemote === null ? '' : ` [remote ${row.graphRemote}]`}`,
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

  const remote = Command.make(
    'remote',
    {
      json,
      ref: Argument.String('name|id'),
      remote: Argument.String('remote').pipe(
        Argument.optional,
        Argument.withDescription(
          'git@host:owner/graph.git, an https URL or the absolute path of a bare repository; omitted, show the remote',
        ),
      ),
      off: Flag.Boolean('off').pipe(
        Flag.withDefault(false),
        Flag.withDescription('take the remote away: the graph lives on this machine alone'),
      ),
      restore: Flag.Boolean('restore').pipe(
        Flag.withDefault(false),
        Flag.withDescription('set this machine’s graph aside and take the graph the remote holds'),
      ),
    },
    ({ json, ref, remote, off, restore }) =>
      Effect.gen(function* () {
        const lens = here(yield* CurrentInvocation);
        const named = Option.getOrNull(remote);
        const answer =
          named === null && !off
            ? { ...(yield* perform(REGISTRY_OPERATIONS.read_graph_remote, { ref }, lens)), setAside: null }
            : yield* perform(REGISTRY_OPERATIONS.set_graph_remote, { ref, remote: off ? null : named, restore }, lens);
        if (json) return yield* print(answer, true);
        yield* Console.log(renderRemote(answer.remote, answer.setAside));
      }),
  ).pipe(
    Command.withDescription(
      'the private git remote of a stealth project’s graph: show it, set it and exchange now, take it away with --off, or take the graph it holds with --restore',
    ),
  );

  return [set, storage, remote] as const;
};

const renderRemote = (state: GraphRemote, setAside: string | null): string =>
  [
    state.remote === null ? 'remote: none — the graph lives on this machine alone' : `remote: ${state.remote} — holds ${state.holds}`,
    ...state.branches.map((one) => `  ${one.branch}: ${one.state}`),
    state.exchanging ? 'exchanging now' : `last exchange: ${state.exchangedAt ?? 'none since the server started'}`,
    ...(state.failure === null ? [] : [`failed at ${state.failure.at}: ${state.failure.message}`]),
    ...(setAside === null ? [] : [`this machine's graph set aside in ${setAside}`]),
  ].join('\n');
