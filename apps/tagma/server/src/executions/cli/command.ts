import { Console, Effect, Option, Result, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { ByteOffset, type RecordRange, type StreamPositions } from '@runlith/executions/protocol/record';
import { refuse, print, write, type Invocation } from '../../platform/cli/verb.js';

type Lens = { readonly cwd?: string; readonly project?: string };

export type CommandDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: 'read_command_bytes' };
      readonly query: Lens;
      readonly headers: Record<string, string | number | undefined>;
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export type CommandCli = {
  readonly ask: <A>(call: (door: CommandDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly lens: (at: Invocation, options: { readonly project?: string | undefined }) => Lens;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);
const execution = Flag.String('execution').pipe(Flag.withMetavar('id'), Flag.withDescription('the execution this read addresses'));
const incarnation = Flag.Int('incarnation').pipe(
  Flag.withMetavar('n'),
  Flag.withDescription('the host generation it was answered at; an old generation addresses nothing'),
);
const at = (input: { readonly execution: string; readonly incarnation: number }) => ({
  execution: input.execution,
  incarnation: input.incarnation,
});
const STREAMS = ['stdout', 'stderr', 'output', 'pty'] as const;
const streamOf = (value: string): (typeof STREAMS)[number] =>
  (STREAMS as readonly string[]).includes(value)
    ? (value as (typeof STREAMS)[number])
    : refuse('selection-shape', `\`${value}\` is not a stream of an execution`, [`name one of: ${STREAMS.join(', ')}`]);

type Chunk = { readonly range: RecordRange; readonly positions?: StreamPositions; readonly bytes: string };

const chunkOf = (answer: unknown): Chunk => {
  const { status: _answered, ...chunk } = answer as Chunk & { readonly status: string };
  return chunk;
};

const offsetOf = (value: string): Effect.Effect<ByteOffset, { code: string; reason: string; unblock: string[] }> => {
  const parsed = Schema.decodeUnknownResult(ByteOffset)(value);
  return Result.isFailure(parsed)
    ? Effect.fail({
        code: 'selection-shape',
        reason: `\`${value}\` is not a canonical decimal byte offset`,
        unblock: ['pass a non-negative integer as a decimal string, e.g. 0'],
      })
    : Effect.succeed(parsed.success);
};

const bytes = ({ ask, lens }: CommandCli) =>
  Command.make(
    'bytes',
    {
      json,
      project,
      execution,
      incarnation,
      stream: Flag.String('stream').pipe(Flag.withMetavar('stdout|stderr|output|pty'), Flag.withDescription('which stream to read')),
      offset: Flag.String('offset').pipe(
        Flag.withMetavar('n'),
        Flag.withDescription('where to read from, as a canonical decimal string; a JS number rounds past 2^53'),
      ),
      limit: Flag.Int('limit').pipe(Flag.optional, Flag.withDescription('how many bytes at most')),
    },
    (input) =>
      Effect.gen(function* () {
        const offset = yield* offsetOf(input.offset);
        const answer = yield* ask((door, invocation) =>
          door.operations.perform({
            params: { id: 'read_command_bytes' },
            query: lens(invocation, { project: optional(input.project) }),
            headers: {},
            payload: {
              ...at(input),
              stream: streamOf(input.stream),
              offset,
              limit: optional(input.limit) === undefined ? undefined : (optional(input.limit) as number),
              positions: true,
            },
          }),
        );
        const chunk = chunkOf(answer);
        if (input.json) return yield* print(chunk, true);
        yield* write(Buffer.from(chunk.bytes, 'base64'));
        yield* Console.error(
          `# ${chunk.range.cursor.stream} ${chunk.range.cursor.offset} → ${chunk.range.next}, retained from ${chunk.range.retainedFrom}, durable through ${chunk.range.durableThrough}${
            chunk.range.gap ? ' — GAP: bytes below the retained window are gone' : ''
          }${chunk.positions === undefined ? ' — the host answered no positions for this stream' : `, ${chunk.positions.ending}`}`,
        );
      }),
  ).pipe(Command.withDescription('read one retained byte range from a bounded command stream'));

export const command = (cli: CommandCli) =>
  Command.make('command').pipe(Command.withDescription('retained byte streams of bounded commands'), Command.withSubcommands([bytes(cli)]));
