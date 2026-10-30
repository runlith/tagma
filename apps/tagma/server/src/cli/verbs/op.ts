import { resolve } from 'node:path';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { ANSWER_HEADER, ANSWER_TEXT, CALL_HEADER, OUTCOME_HEADER, answerParts } from '../../invocation/contract/wire/headers.js';
import { operationNotes } from '../../platform/contract/wire/operation.js';
import type { OperationsCli } from '../contract/service/operations.js';
import { lens } from '../door.js';
import { end, refuse, CurrentInvocation, type Invocation, print } from '../../platform/cli/verb.js';

const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);
const json = Flag.Boolean('json').pipe(
  Flag.withDefault(false),
  Flag.withDescription('print the catalog or an answer as its JSON document instead of text'),
);
const yes = Flag.Boolean('yes').pipe(
  Flag.withDefault(false),
  Flag.withDescription("confirm an entry declared destructive; the terminal doesn't prompt"),
);
const project = Flag.String('project').pipe(Flag.optional, Flag.withMetavar('name|id'));
const call = Flag.String('call').pipe(
  Flag.optional,
  Flag.withMetavar('key'),
  Flag.withDescription(
    'the key naming this call: a repeat under the same key answers the first outcome; omitted, this invocation mints its own',
  ),
);
const id = Argument.String('id').pipe(Argument.optional, Argument.withDescription('the operation id; omitted, list the catalog'));
const input = Argument.String('input').pipe(
  Argument.optional,
  Argument.withDescription('an existing JSON file, "-" for stdin, or inline JSON; omitted means {}'),
);

function namedOperation(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('op');
  if (at < 0) return undefined;
  for (let index = at + 1; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--json' || token === '--help' || token === '-h') continue;
    if (token === '--project' || token === '--scope' || token === '--call') {
      index += 1;
      continue;
    }
    if (['--project=', '--scope=', '--call='].some((flag) => token.startsWith(flag))) continue;
    if (token.startsWith('-')) continue;
    return token;
  }
  return undefined;
}

const parsed = (text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
};

const invalid = (reason: string): never =>
  refuse('input-invalid', reason, [
    'pass one JSON value inline',
    'or pass an existing file containing JSON',
    'or pass - and write JSON to stdin',
  ]);

function readInput(at: Invocation, source: string | undefined): Effect.Effect<unknown> {
  if (source === undefined) return Effect.succeed({});
  if (source === '-') {
    return Effect.flatMap(Effect.tryPromise({ try: () => new Response(at.stdin()).text(), catch: (error) => String(error) }), (text) => {
      const stdin = parsed(text);
      return Effect.sync(() => (stdin.ok ? stdin.value : invalid(`stdin is not JSON: ${stdin.reason}`)));
    }).pipe(Effect.mapError((reason) => invalid(`stdin could not be read: ${reason}`)));
  }

  const inline = parsed(source);
  if (inline.ok) return Effect.succeed(inline.value);
  const file = Bun.file(resolve(at.cwd, source));
  return Effect.flatMap(Effect.tryPromise({ try: () => file.exists(), catch: (error) => String(error) }), (exists) => {
    if (!exists) {
      return Effect.sync(() => invalid(`inline JSON failed: ${inline.reason}; file lookup failed: no file exists at ${source}`));
    }
    return Effect.flatMap(Effect.tryPromise({ try: () => file.text(), catch: (error) => String(error) }), (text) => {
      const held = parsed(text);
      return Effect.sync(() =>
        held.ok ? held.value : invalid(`inline JSON failed: ${inline.reason}; file ${source} is not JSON: ${held.reason}`),
      );
    }).pipe(Effect.mapError((reason) => invalid(`inline JSON failed: ${inline.reason}; file ${source} could not be read: ${reason}`)));
  }).pipe(Effect.mapError((reason) => invalid(`inline JSON failed: ${inline.reason}; file lookup for ${source} failed: ${reason}`)));
}

export const operations = <Id extends string>({ registry, blockRefFlag, ask, inputSchema }: OperationsCli<Id>) => {
  const scope = blockRefFlag('scope').pipe(Flag.optional);
  const performedBy = (named: string): Id =>
    registry.named(named) ??
    refuse('unknown-operation', `no operation is named ${named}`, [
      'tagma op — list the catalog',
      'tagma op <id> --help — read the selected entry',
    ]);

  const preface = (argv: readonly string[]): string | undefined => {
    const named = namedOperation(argv);
    if (named === undefined) return undefined;
    const operationId = performedBy(named);
    if (!argv.some((token) => token === '--help' || token === '-h')) return undefined;
    const entry = registry.entry(operationId);
    const notes = operationNotes(entry);
    return [
      `tagma op ${operationId}${'intent' in entry && entry.intent === 'destructive' ? ' --yes' : ''} <input>`,
      'prints the answer as text; --json prints its JSON document',
      '',
      entry.meaning,
      ...(notes === '' ? [] : ['', notes]),
      '',
      'Input schema (JSON Schema):',
      JSON.stringify(inputSchema(entry.params), null, 2),
    ].join('\n');
  };

  const op = Command.make('op', { json, yes, project, scope, call, id, input }, (options) =>
    Effect.gen(function* () {
      const named = optional(options.id);
      if (named === undefined) {
        const catalog = registry.ids.map((operationId) => ({ id: operationId, meaning: registry.entry(operationId).meaning }));
        return yield* print(options.json ? catalog : catalog.map((entry) => `${entry.id} — ${entry.meaning}`).join('\n'), options.json);
      }
      const operationId = performedBy(named);
      const entry = registry.entry(operationId);
      const payload = yield* readInput(yield* CurrentInvocation, optional(options.input));
      if ('intent' in entry && entry.intent === 'destructive' && !options.yes) {
        const warningInput = typeof payload === 'object' && payload !== null ? payload : {};
        return refuse(
          'confirmation-required',
          `${entry.confirmLabel} requires explicit confirmation. ${entry.destructiveConsequence(warningInput)}`,
          [
            `tagma op ${named} --yes <input> — acknowledge this consequence and perform the operation`,
            `tagma op ${named} --help — read the entry before confirming it`,
          ],
        );
      }
      const key = optional(options.call)?.trim() || crypto.randomUUID();
      const [answered, response] = yield* ask((door, at) =>
        door.operations.perform({
          params: { id: named },
          query: lens(at, { project: optional(options.project), scope: optional(options.scope) }),
          headers: options.json ? { [CALL_HEADER]: key } : { [CALL_HEADER]: key, [ANSWER_HEADER]: ANSWER_TEXT },
          payload,
          responseMode: 'decoded-and-response',
        }),
      );
      const { document, text } = answerParts(answered);
      yield* print(options.json || text === undefined ? JSON.stringify(document, null, 2) : text, false);
      if (response.headers[OUTCOME_HEADER] === 'negative') end(1);
    }),
  ).pipe(Command.withDescription('the operation catalog: one id, one JSON input and the entry that defines both'));
  return { op, preface };
};
