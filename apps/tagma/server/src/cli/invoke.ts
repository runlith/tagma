import { Cause, Console, Effect, Layer } from 'effect';
import { CliConfig, Command, GlobalFlag } from 'effect/cli';
import { exitCodeOf, cliHelp } from '../platform/cli/verb.js';
import { loadVerbs, verbNamed, type VerbSources } from './verbs.js';

function namedVerb(argv: readonly string[]): string | undefined {
  for (const token of argv) {
    if (token === '--') return undefined;
    if (!token.startsWith('-')) return token;
  }
  return undefined;
}

function versionOnly(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--version' || token === '-v') && !argv.some((token) => token === '--help' || token === '-h');
}

const performed = Effect.fnUntraced(function* (argv: readonly string[], contributions: VerbSources, version: string) {
  const verb = namedVerb(argv);
  const named = verb === undefined ? undefined : yield* Effect.promise(() => verbNamed(verb, contributions));
  const help = named?.preface?.(argv);
  if (help !== undefined) return yield* Console.log(help);
  const one = named?.command;
  const subcommands =
    one !== undefined ? [one] : verb === undefined && versionOnly(argv) ? [] : yield* Effect.promise(() => loadVerbs(contributions));
  const root = Command.make('tagma').pipe(
    Command.withDescription('durable project knowledge as one queryable graph'),
    Command.withSubcommands(subcommands),
  );
  yield* Command.runWith(root, { version })(argv).pipe(
    Effect.provide(Layer.mergeAll(cliHelp, CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] }))),
  );
});

export const invoke = (
  argv: readonly string[],
  contributions: VerbSources,
  version: string,
): Effect.Effect<number, never, Command.Environment> =>
  (performed(argv, contributions, version) as Effect.Effect<void, unknown, Command.Environment>).pipe(
    Effect.as(0),
    Effect.catchCause((cause) => exitCodeOf(Cause.squash(cause), argv.includes('--json'))),
  );
