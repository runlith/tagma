import { Console, Context, Effect, Stdio, Stream } from 'effect';
import { CliError, CliOutput, Command } from 'effect/cli';
import { plainLines } from '../contract/wire/plainText.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { RefusalBody, Words } from '../contract/wire/refusal.js';

export class Notes extends Context.Service<Notes, string>()('tagma/platform/Notes') {}

export const noting =
  (text: string) =>
  <C>(command: C): C =>
    Command.annotate(command as never, Notes, text.trim()) as C;

const DASH_VALUE_RULE =
  '\nA value that begins with `-` is written `--flag=value`: a bullet, a diff line or a switch\nspelled with a space would be read as another flag.\n';

const dashy = (error: CliError.CliError): boolean =>
  error._tag === 'UnrecognizedOption' || error._tag === 'MissingOption' || error._tag === 'InvalidValue';

const base = CliOutput.defaultFormatter();

export const cliHelp = CliOutput.layer({
  ...base,
  formatHelpDoc: (doc) => {
    const notes = Context.getOrUndefined(doc.annotations, Notes);
    return notes === undefined ? base.formatHelpDoc(doc) : `${base.formatHelpDoc(doc)}\n${notes}\n`;
  },
  formatError: (error) => (dashy(error) ? `${base.formatError(error)}\n${DASH_VALUE_RULE}` : base.formatError(error)),
  formatErrors: (errors) => (errors.some(dashy) ? `${base.formatErrors(errors)}\n${DASH_VALUE_RULE}` : base.formatErrors(errors)),
});

class Refused implements RefusalBody {
  constructor(
    readonly code: string,
    readonly reason: string,
    readonly unblock: readonly string[],
    readonly words?: Words,
  ) {}
}

class Ended {
  constructor(readonly code: number) {}
}

export const refusalOf = (failure: unknown): RefusalBody | null =>
  typeof failure === 'object' && failure !== null && 'code' in failure && 'unblock' in failure ? (failure as RefusalBody) : null;

export const failureLines = (failure: unknown): string[] => {
  const refusal = refusalOf(failure);
  return refusal === null ? [failure instanceof Error ? failure.message : String(failure)] : refusalLines(refusal);
};

export const exitCodeOf = (failure: unknown, json: boolean): Effect.Effect<number> => {
  if (failure instanceof Ended) return Effect.succeed(failure.code);
  const refusal = refusalOf(failure);
  if (refusal === null) return Effect.as(Console.error(failureLines(failure).join('\n')), 1);
  return Effect.as(json ? Console.log(JSON.stringify(failure)) : Console.error(refusalLines(refusal).join('\n')), 2);
};

export function refuse(code: string, reason: string, unblock: string[], words?: Words): never {
  throw new Refused(code, reason, unblock, words);
}

export function end(code: number): never {
  throw new Ended(code);
}

export function print(value: unknown, json: boolean) {
  if (Array.isArray(value) && !json && value.length === 0) return Effect.void;
  const text =
    typeof value === 'string'
      ? value
      : json
        ? JSON.stringify(value, null, 2)
        : Array.isArray(value)
          ? value.map(rowText).join('\n')
          : rowText(value);
  return write(`${text}\n`);
}

export function write(text: string | Uint8Array) {
  return Effect.flatMap(Stdio.Stdio, (stdio) => Stream.run(Stream.make(text), stdio.stdout()));
}

function rowText(item: unknown): string {
  return plainLines(item).join('\n');
}

export type Environment = Record<string, string | undefined>;

const temporaryOf = (env: Environment): string => {
  const named = env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return named.length > 1 && named.endsWith('/') ? named.slice(0, -1) : named;
};

export class Invocation {
  readonly temporary: string;

  constructor(
    readonly env: Environment,
    readonly cwd: string,
    readonly stdin: () => ReadableStream<Uint8Array>,
    readonly entry: string,
  ) {
    this.temporary = temporaryOf(env);
  }
}

export const processInvocation = (): Invocation => new Invocation(process.env, process.cwd(), () => Bun.stdin.stream(), Bun.main);

export const CurrentInvocation = Context.Reference<Invocation>('tagma/platform/CurrentInvocation', {
  defaultValue: processInvocation,
});
