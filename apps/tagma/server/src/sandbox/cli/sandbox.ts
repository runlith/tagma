import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { print } from '../../platform/cli/verb.js';
import type { SandboxCli, SandboxCliRow } from './port.js';

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

const line = (row: SandboxCliRow) => {
  const source = row.source === null ? 'unprepared' : row.source.kind === 'project' ? `commit ${row.source.commit?.slice(0, 12)}` : 'empty';
  const held = row.boundThreadId ? ` held by ${row.boundThreadId}` : '';
  const why = row.failureReason ? ` — ${row.failureReason}` : '';
  const exported = row.exportPath ? ` → ${row.exportPath}` : '';
  return `${row.sandbox} [${row.state}] ${source}${held}${why}${exported}`;
};

export const sandboxCommand = ({ list: listSandboxes, birth }: SandboxCli) => {
  const list = Command.make('list', { json, project }, (input) =>
    Effect.gen(function* () {
      const rows = yield* listSandboxes(optional(input.project));
      if (input.json) return yield* print(rows, true);
      yield* print(rows.map(line).join('\n'), false);
    }),
  ).pipe(Command.withDescription('the sandboxes of this project whose resources still stand'));

  const run = Command.make(
    'run',
    {
      json,
      project,
      id: Argument.String('id').pipe(Argument.withDescription('the sandbox that hosts the thread')),
      type: Flag.String('type').pipe(
        Flag.withDefault('tagma'),
        Flag.withDescription('the agent the thread opens as — in code or declared in a file; omitted, tagma'),
      ),
      title: Flag.String('title').pipe(Flag.optional, Flag.withDescription("the thread's name in the project list")),
    },
    (input) =>
      Effect.gen(function* () {
        const title = optional(input.title);
        const created = yield* birth({
          project: optional(input.project),
          type: input.type,
          id: input.id,
          title,
        });
        yield* print(input.json ? created.thread : created.id, input.json);
      }),
  ).pipe(
    Command.withDescription(
      'open a thread bound to a sandbox; it holds no first turn — the words reach it from a surface that speaks turns',
    ),
  );

  return Command.make('sandbox').pipe(
    Command.withDescription('operator reads and thread birth over isolated sandbox guests'),
    Command.withSubcommands([list, run]),
  );
};
