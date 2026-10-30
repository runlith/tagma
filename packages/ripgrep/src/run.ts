import { Data, Duration, Effect, Exit, Fiber, Option, type PlatformError, Result, Schema, Scope, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import type { ChildProcessHandle } from 'effect/process/ChildProcessSpawner';
import { STOP_LADDER, STOP_LADDER_MS } from '@runlith/executions/protocol/call';

export type SearchRun = {
  readonly binary: string;
  readonly cwd: string;
  readonly platform: string;
  readonly ceilingMs: number;
};

export type ContentQuery = {
  readonly pattern: string;
  readonly globs?: readonly string[];
  readonly types?: readonly string[];
  readonly typesNot?: readonly string[];
  readonly typeAdd?: readonly string[];
  readonly file?: string;
  readonly fixed?: boolean;
  readonly ignoreCase?: boolean;
  readonly word?: boolean;
  readonly multiline?: boolean;
  readonly before?: number;
  readonly after?: number;
  readonly hidden?: boolean;
  readonly maxFilesize?: number;
  readonly maxColumns?: number;
  readonly maxCount?: number;
  readonly raw?: boolean;
};

export type MatchRange = { readonly start: number; readonly end: number };

export type Match = {
  readonly _tag: 'Match';
  readonly path: string;
  readonly line: number;
  readonly offset: number;
  readonly text: string;
  readonly ranges: readonly MatchRange[];
};

export type Context = {
  readonly _tag: 'Context';
  readonly path: string;
  readonly line: number;
  readonly offset: number;
  readonly text: string;
};

export type FileDone = { readonly _tag: 'FileDone'; readonly path: string };

export type Listed = { readonly _tag: 'Listed'; readonly path: string };

export type Counted = { readonly _tag: 'Counted'; readonly path: string; readonly count: number };

export type Summary = { readonly _tag: 'Summary'; readonly partial: boolean };

export type ContentEvent = Match | Context | FileDone | Summary;

export type ListEvent = Listed | Summary;

export type CountEvent = Counted | Summary;

const quoted = (value: string): string => JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);

export class SearchFailed extends Data.TaggedError('SearchFailed')<{
  readonly exitCode: number;
  readonly diagnosis: string;
}> {
  override get message(): string {
    return `ripgrep failed (exit ${this.exitCode}): ripgrep said: ${JSON.stringify(this.diagnosis)}`;
  }

  get badPattern(): boolean {
    return this.diagnosis.includes('regex parse error');
  }
}

export class SearchLapsed extends Data.TaggedError('SearchLapsed')<{
  readonly args: readonly string[];
  readonly ceilingMs: number;
}> {
  override get message(): string {
    return `ripgrep did not end within ${this.ceilingMs} ms, the search ceiling this world was given, so the search was ended and answered nothing rather than standing for ever. It was called with: ${quoted(this.args.join(' '))}. Narrow it — a path, a glob — and call again.`;
  }
}

export type SearchFailure = SearchFailed | SearchLapsed | PlatformError.PlatformError;

const WORKERS = 6;

const ENVELOPE: ReadonlyArray<string> = ['--no-config', `--threads=${WORKERS}`];

const STDERR_KEPT = 4096;

const WIN32_ESCALATION_MS = 3_000;

type Ended = { readonly exitCode: number; readonly stderr: string };

type Reading<A> = {
  readonly line: (text: string) => readonly A[];
  readonly end: (ended: Ended) => Result.Result<readonly A[], SearchFailed>;
};

type Child = { readonly handle: ChildProcessHandle; readonly scope: Scope.Closeable };

const diagnosisOf = (stderr: string): string => stderr.trim() || 'no stderr';

const headOf = <E>(stderr: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stderr.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (kept: string, chunk: string) => (kept.length >= STDERR_KEPT ? kept : kept + chunk),
    ),
  );

const endOnWindows = (handle: ChildProcessHandle): Effect.Effect<void, PlatformError.PlatformError> =>
  handle
    .kill({ forceKillAfter: Duration.millis(WIN32_ESCALATION_MS) })
    .pipe(Effect.timeoutOption(Duration.millis(2 * WIN32_ESCALATION_MS)), Effect.asVoid);

const endOnUnix = Effect.fn('ripgrep.endOnUnix')(function* (handle: ChildProcessHandle) {
  const forceAfter = STOP_LADDER.killAtMs - STOP_LADDER.terminateAtMs;
  const terminate = handle
    .kill({ killSignal: 'SIGTERM', forceKillAfter: Duration.millis(forceAfter) })
    .pipe(Effect.timeoutOption(Duration.millis(forceAfter + STOP_LADDER.reapMs)), Effect.asVoid);
  yield* Effect.matchEffect(handle.kill({ killSignal: 'SIGINT' }).pipe(Effect.timeoutOption(Duration.millis(STOP_LADDER.terminateAtMs))), {
    onFailure: () => terminate,
    onSuccess: (interrupted) => (Option.isSome(interrupted) ? Effect.void : terminate),
  });
});

const ended = Effect.fn('ripgrep.ended')(function* (child: Child, platform: string) {
  const stop = platform === 'win32' ? endOnWindows(child.handle) : endOnUnix(child.handle);
  yield* Effect.matchEffect(child.handle.isRunning, {
    onFailure: () => stop,
    onSuccess: (running) => (running ? stop : Effect.void),
  });
});

//! A spawner's release may wait for an exit that never comes and finalizers cannot be interrupted, so the child is ended on a fiber of its own and the stream waits for that only as long as a kill may take.
const settled = (child: Child, platform: string): Effect.Effect<void> =>
  Effect.forkDetach(ended(child, platform).pipe(Effect.ensuring(Scope.close(child.scope, Exit.void)))).pipe(
    Effect.flatMap((ending) => Fiber.await(ending).pipe(Effect.timeoutOption(Duration.millis(STOP_LADDER_MS)))),
    Effect.asVoid,
  );

const spawned = <A>(
  run: SearchRun,
  args: readonly string[],
  reading: Reading<A>,
): Stream.Stream<A, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> => {
  const limits: Effect.Effect<never, SearchLapsed> = Effect.sleep(Duration.millis(run.ceilingMs)).pipe(
    Effect.andThen(Effect.fail(new SearchLapsed({ args, ceilingMs: run.ceilingMs }))),
  );
  const acquire = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const handle = yield* ChildProcess.make(run.binary, [...ENVELOPE, ...args], { cwd: run.cwd, stdin: 'ignore' }).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    return { handle, scope } satisfies Child;
  });
  const begin = Effect.gen(function* () {
    const child = yield* acquire;
    const stderr = yield* Effect.forkScoped(headOf(child.handle.stderr)).pipe(Effect.onError(() => settled(child, run.platform)));
    return { child, stderr };
  });
  return Stream.unwrap(
    Effect.map(begin, ({ child, stderr }) => {
      const lines = child.handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.flatMap((text) => Stream.fromIterable(reading.line(text))),
      );
      const tail = Stream.unwrap(
        Effect.gen(function* () {
          const exitCode = yield* child.handle.exitCode;
          const said = yield* Fiber.join(stderr);
          const result = reading.end({ exitCode, stderr: said });
          return Result.isFailure(result) ? Stream.fail(result.failure) : Stream.fromIterable(result.success);
        }),
      );
      return Stream.concat(lines, tail).pipe(Stream.ensuring(settled(child, run.platform)));
    }),
  ).pipe(Stream.interruptWhen(limits));
};

const complained = (exitCode: number): boolean => exitCode !== 0 && exitCode !== 1;

type Submatch = { readonly start: number; readonly end: number };

const textField = Schema.Struct({ text: Schema.optional(Schema.String) });
const linesField = Schema.Struct({ text: Schema.optional(Schema.String), bytes: Schema.optional(Schema.String) });
const contentLine = Schema.Struct({
  type: Schema.Literals(['match', 'context']),
  data: Schema.Struct({
    path: textField,
    line_number: Schema.Finite,
    absolute_offset: Schema.Finite,
    lines: Schema.optional(linesField),
    submatches: Schema.optional(Schema.Array(Schema.Struct({ start: Schema.Finite, end: Schema.Finite }))),
  }),
});
const decodeContentLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal('summary') }),
      Schema.Struct({ type: Schema.Literal('end'), data: Schema.Struct({ path: textField }) }),
      contentLine,
    ]),
  ),
);

const ASCII = /^[\x00-\x7f]*$/;

const encoder = new TextEncoder();

const lossy = new TextDecoder();

const utf16Ranges = (text: string, raw: Uint8Array | undefined, submatches: readonly Submatch[]): readonly MatchRange[] => {
  if (raw === undefined && ASCII.test(text)) return submatches.map(({ start, end }) => ({ start, end }));
  const bytes = raw ?? encoder.encode(text);
  const offsets = [...new Set(submatches.flatMap((one) => [one.start, one.end]))].sort((left, right) => left - right);
  const indexAt = new Map<number, number>();
  let byte = 0;
  let index = 0;
  for (const offset of offsets) {
    if (offset > bytes.length) break;
    for (; byte < offset; byte += 1) {
      const lead = bytes[byte] ?? 0;
      if ((lead & 0xc0) !== 0x80) index += lead >= 0xf0 ? 2 : 1;
    }
    if (((bytes[offset] ?? 0) & 0xc0) !== 0x80) indexAt.set(offset, index);
  }
  return submatches.flatMap((one) => {
    const start = indexAt.get(one.start);
    const end = indexAt.get(one.end);
    return start === undefined || end === undefined ? [] : [{ start, end }];
  });
};

const previewOf = (
  text: string,
  ranges: readonly MatchRange[],
  columns: number | undefined,
): { readonly text: string; readonly ranges: readonly MatchRange[] } => {
  if (columns === undefined || text.length <= columns) return { text, ranges };
  const high = (text.charCodeAt(columns - 1) & 0xfc00) === 0xd800;
  const cut = high ? columns - 1 : columns;
  return {
    text: text.slice(0, cut),
    ranges: ranges.flatMap((one) => (one.start >= cut ? [] : [{ start: one.start, end: Math.min(one.end, cut) }])),
  };
};

function contentReading(columns: number | undefined): Reading<ContentEvent> {
  let searched = false;
  return {
    line: (text) => {
      if (text === '') return [];
      const decoded = decodeContentLine(text);
      if (Option.isNone(decoded)) return [];
      const entry = decoded.value;
      if (entry.type === 'summary') {
        searched = true;
        return [];
      }
      const path = entry.data.path.text;
      if (path === undefined || path === '') return [];
      if (entry.type === 'end') return [{ _tag: 'FileDone', path }];
      const line = entry.data.line_number;
      const offset = entry.data.absolute_offset;
      const encoded = entry.data.lines?.text === undefined ? entry.data.lines?.bytes : undefined;
      const raw = encoded === undefined ? undefined : Uint8Array.from(Buffer.from(encoded, 'base64'));
      const body = raw === undefined ? (entry.data.lines?.text ?? '') : lossy.decode(raw);
      const whole = body.endsWith('\n') ? body.slice(0, -1) : body;
      if (entry.type === 'context') return [{ _tag: 'Context', path, line, offset, text: previewOf(whole, [], columns).text }];
      const shown = previewOf(whole, utf16Ranges(whole, raw, entry.data?.submatches ?? []), columns);
      return [{ _tag: 'Match', path, line, offset, text: shown.text, ranges: shown.ranges }];
    },
    end: ({ exitCode, stderr }) =>
      complained(exitCode) && !searched
        ? Result.fail(new SearchFailed({ exitCode, diagnosis: diagnosisOf(stderr) }))
        : Result.succeed([{ _tag: 'Summary', partial: complained(exitCode) }]),
  };
}

function lineReading<A>(parse: (text: string) => A | undefined): Reading<A | Summary> {
  let listed = 0;
  return {
    line: (text) => {
      const parsed = text === '' ? undefined : parse(text);
      if (parsed === undefined) return [];
      listed += 1;
      return [parsed];
    },
    end: ({ exitCode, stderr }) =>
      complained(exitCode) && listed === 0 && stderr.trim() !== ''
        ? Result.fail(new SearchFailed({ exitCode, diagnosis: diagnosisOf(stderr) }))
        : Result.succeed([{ _tag: 'Summary', partial: complained(exitCode) }]),
  };
}

const listed = (path: string): Listed => ({ _tag: 'Listed', path });

const counted = (text: string): Counted | undefined => {
  const at = text.lastIndexOf(':');
  const count = Number(text.slice(at + 1));
  return at <= 0 || !Number.isSafeInteger(count) ? undefined : { _tag: 'Counted', path: text.slice(0, at), count };
};

const queryArgs = (query: ContentQuery): string[] => {
  const args: string[] = [];
  for (const glob of query.globs ?? []) args.push('--glob', glob);
  for (const definition of query.typeAdd ?? []) args.push('--type-add', definition);
  for (const type of query.types ?? []) args.push('--type', type);
  for (const type of query.typesNot ?? []) args.push('--type-not', type);
  if (query.fixed === true) args.push('--fixed-strings');
  if (query.ignoreCase === true) args.push('--ignore-case');
  if (query.word === true) args.push('--word-regexp');
  if (query.multiline === true) args.push('--multiline', '--multiline-dotall');
  if (query.hidden === true) args.push('--hidden');
  if (query.maxFilesize !== undefined) args.push('--max-filesize', String(query.maxFilesize));
  if (query.maxCount !== undefined) args.push('--max-count', String(query.maxCount));
  if (query.raw === true) args.push('--text', '--encoding', 'none');
  args.push('--', query.pattern);
  if (query.file !== undefined) args.push(query.file);
  return args;
};

export const searchContent = (
  run: SearchRun,
  query: ContentQuery,
): Stream.Stream<ContentEvent, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> => {
  const args = ['--json', '--no-heading', '--with-filename', '--color=never'];
  if (query.before !== undefined && query.before > 0) args.push('--before-context', String(query.before));
  if (query.after !== undefined && query.after > 0) args.push('--after-context', String(query.after));
  args.push(...queryArgs(query));
  return Stream.suspend(() => spawned(run, args, contentReading(query.maxColumns)));
};

export const matchingFiles = (
  run: SearchRun,
  query: ContentQuery,
): Stream.Stream<ListEvent, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.suspend(() => spawned(run, ['--files-with-matches', '--no-messages', '--color=never', ...queryArgs(query)], lineReading(listed)));

export const countMatches = (
  run: SearchRun,
  query: ContentQuery,
): Stream.Stream<CountEvent, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.suspend(() =>
    spawned(run, ['--count-matches', '--with-filename', '--no-messages', '--color=never', ...queryArgs(query)], lineReading(counted)),
  );

export const countLines = (
  run: SearchRun,
  query: ContentQuery,
): Stream.Stream<CountEvent, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.suspend(() =>
    spawned(run, ['--count', '--with-filename', '--no-messages', '--color=never', ...queryArgs(query)], lineReading(counted)),
  );

export const listFiles = (run: SearchRun, glob: string): Stream.Stream<ListEvent, SearchFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Stream.suspend(() => spawned(run, ['--files', '--no-messages', '--glob', glob, '--color=never'], lineReading(listed)));
