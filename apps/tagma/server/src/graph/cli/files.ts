import { Console, Effect, Option } from 'effect';
import { Command, Flag, type Argument } from 'effect/cli';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { HISTORY_OPERATIONS } from '../contract/wire/operations/history.js';

export type FilesCli = {
  readonly perform: Perform;
  readonly lens: (at: Invocation, options: { project?: string | undefined }) => DoorLens;
  readonly blockRef: (name: string) => Argument.Argument<string>;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));

export const files = ({ perform, lens, blockRef }: FilesCli) => {
  const log = Command.make(
    'log',
    {
      json,
      id: blockRef('block'),
      project: Flag.String('project').pipe(
        Flag.optional,
        Flag.withMetavar('name|id'),
        Flag.withDescription('defaults to the project whose root contains the cwd'),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const project = Option.getOrUndefined(o.project);
        const at = yield* CurrentInvocation;
        const { log: entries } = yield* perform(HISTORY_OPERATIONS.read_block_log, { blockId: o.id }, lens(at, { project }));
        if (o.json) {
          yield* print(entries, true);
          return;
        }
        for (const entry of entries) {
          yield* Console.log(`${entry.sha.slice(0, 10)}  ${entry.date}  ${entry.author}  ${entry.message}`);
        }
      }),
  ).pipe(Command.withDescription("one block's file history, read off the tree's git"));

  const resolve = Command.make(
    'resolve',
    {
      json,
      project: Flag.String('project').pipe(
        Flag.optional,
        Flag.withMetavar('name|id'),
        Flag.withDescription('defaults to the project whose root contains the cwd'),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const { status: _resolved, ...report } = yield* perform(
          HISTORY_OPERATIONS.resolve_graph_conflict,
          {},
          lens(at, { project: Option.getOrUndefined(o.project) }),
        );
        yield* print(report, o.json);
      }),
  ).pipe(Command.withDescription('conclude the open merge: what now stands in the conflicted files becomes the commit'));

  return Command.make('files').pipe(
    Command.withDescription('the file floor: the tree, its history and its merges'),
    Command.withSubcommands([log, resolve]),
  );
};
