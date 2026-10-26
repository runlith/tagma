import { Effect, FileSystem, Path, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { countLines, searchContent, type ContentQuery, type SearchFailure, type SearchRun } from '@runlith/ripgrep/run';
import { mintCursor, readCursor, type PageKey, type PageQuestion } from '@runlith/paging';
import { ByteOffset, byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { cursorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { RipgrepBinary } from '../../platform/contract/service/ripgrep.js';
import {
  OUTPUT_COLUMNS,
  OUTPUT_STREAMS,
  type CommandSearchReading,
  type OutputMatch,
  type OutputStream,
} from '../contract/wire/commands.js';
import type { CommandSearchRequest, ManagedCommands } from '../contract/service/commands.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import type { StoredCommands } from './reader.js';
import { walkRange } from './outputTail.js';
import { statusOf } from './output.js';

const CEILING_MS = 30_000;

const FIRST_WINDOW = 256n * 1024n;

const LINE_FRAME_BYTES = 24;

type Bound = { readonly stream: OutputStream; readonly from: bigint; readonly through: bigint };

type Resume = {
  readonly index: number;
  readonly offset: bigint;
  readonly line: number;
  readonly ordinal: number;
  readonly total: number;
  readonly bounds: readonly Bound[];
};

type Line = { readonly line: number; readonly text: string };

type Row = {
  readonly stream: OutputStream;
  readonly line: number;
  readonly offset: ByteOffset;
  readonly text: string;
  readonly before: Line[];
  readonly after: Line[];
};

type Staged = { readonly through: bigint; readonly lines: number };

type Found = { readonly rows: readonly Row[]; readonly beyond: boolean };

const DECIMAL = /^(0|[1-9][0-9]*)$/u;

const whole = (part: PageKey[number]): number | null => (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 ? part : null);

const position = (part: PageKey[number]): bigint | null => (typeof part === 'string' && DECIMAL.test(part) ? BigInt(part) : null);

const resumeOf = (at: PageKey, streams: readonly OutputStream[]): Resume | null => {
  const [index, offset, line, ordinal, total, ...edges] = at;
  const head = {
    index: whole(index ?? null),
    offset: position(offset ?? null),
    line: whole(line ?? null),
    ordinal: whole(ordinal ?? null),
    total: whole(total ?? null),
  };
  if (head.index === null || head.offset === null || head.line === null || head.ordinal === null || head.total === null) return null;
  if (head.index >= streams.length || edges.length !== streams.length * 2) return null;
  const bounds: Bound[] = [];
  for (const [slot, stream] of streams.entries()) {
    const from = position(edges[slot * 2] ?? null);
    const through = position(edges[slot * 2 + 1] ?? null);
    if (from === null || through === null || from > through) return null;
    bounds.push({ stream, from, through });
  }
  return { index: head.index, offset: head.offset, line: head.line, ordinal: head.ordinal, total: head.total, bounds };
};

const keyOf = (resume: Resume): PageKey => [
  resume.index,
  String(resume.offset),
  resume.line,
  resume.ordinal,
  resume.total,
  ...resume.bounds.flatMap((bound) => [String(bound.from), String(bound.through)]),
];

const refusalOf = (failure: SearchFailure): GateRefusal<'search-failed' | 'search-unavailable'> =>
  failure._tag === 'SearchFailed'
    ? new GateRefusal('search-failed', failure.message, ['correct the pattern and search again'])
    : new GateRefusal('search-unavailable', failure.message, ['search again once ripgrep can run']);

const lowSurrogate = (text: string, at: number): boolean => (text.charCodeAt(at) & 0xfc00) === 0xdc00;

const clipped = (text: string, around: number): string => {
  if (text.length <= OUTPUT_COLUMNS) return text;
  let start = Math.max(0, Math.min(around - Math.floor(OUTPUT_COLUMNS / 4), text.length - OUTPUT_COLUMNS));
  if (lowSurrogate(text, start)) start += 1;
  let end = Math.min(text.length, start + OUTPUT_COLUMNS);
  if (end < text.length && lowSurrogate(text, end)) end -= 1;
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

const rowBytes = (row: Row): number =>
  [row, ...row.before, ...row.after].reduce((sum, line) => sum + Buffer.byteLength(line.text, 'utf8') + LINE_FRAME_BYTES, 0);

const fitted = (rows: readonly Row[], budget: number): readonly Row[] => {
  let spent = 0;
  let kept = 0;
  for (const row of rows) {
    spent += rowBytes(row);
    if (kept > 0 && spent > budget) break;
    kept += 1;
  }
  return rows.slice(0, kept);
};

const NEWLINE = 10;

export const makeOutputSearch = Effect.fnUntraced(function* ({
  commands,
  reader,
}: {
  readonly commands: ManagedCommands['Service'];
  readonly reader: StoredCommands;
}) {
  const binary = yield* RipgrepBinary;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const unstaged = (detail: string) =>
    new TerminalUnavailable({ owner: 'environment', message: `the output could not be staged for search: ${detail}` });

  const stage = Effect.fn('OutputSearch.stage')(function* (
    request: CommandSearchRequest,
    bound: Bound,
    from: bigint,
    end: bigint,
    file: string,
  ) {
    const handle = yield* Effect.mapError(files.open(file, { flag: 'w' }), (error) => unstaged(error.message));
    let lines = 0;
    let cut = -1n;
    let last = NEWLINE;
    yield* walkRange(
      (cursor, limit) => commands.bytes(cursor, limit, request.authority),
      { ref: request.execution, stream: bound.stream, offset: byteOffset(from) },
      end,
      (chunk, at) => {
        for (let found = chunk.indexOf(NEWLINE); found !== -1; found = chunk.indexOf(NEWLINE, found + 1)) {
          lines += 1;
          cut = at + BigInt(found) + 1n;
        }
        if (chunk.length > 0) last = chunk[chunk.length - 1] as number;
        return Effect.mapError(handle.writeAll(chunk), (error) => unstaged(error.message));
      },
    );
    if (end === bound.through) return { through: end, lines: last === NEWLINE ? lines : lines + 1 } satisfies Staged;
    if (cut < 0n) return null;
    yield* Effect.mapError(handle.truncate(Number(cut - from)), (error) => unstaged(error.message));
    return { through: cut, lines } satisfies Staged;
  }, Effect.scoped);

  const ran = <A extends { readonly _tag: string }>(events: Stream.Stream<A, SearchFailure, ChildProcessSpawner.ChildProcessSpawner>) =>
    Effect.flatMap(
      Effect.mapError(Stream.runCollect(Stream.provideService(events, ChildProcessSpawner.ChildProcessSpawner, spawner)), refusalOf),
      (collected) =>
        collected.some((event) => event._tag === 'Summary' && 'partial' in event && event.partial === true)
          ? Effect.fail(new GateRefusal('search-unavailable', 'ripgrep stopped before it read the whole output', ['search again']))
          : Effect.succeed(collected),
    );

  const count = Effect.fn('OutputSearch.count')(function* (run: SearchRun, query: ContentQuery) {
    let total = 0;
    for (const event of yield* ran(countLines(run, query))) if (event._tag === 'Counted') total += event.count;
    return total;
  });

  const matches = Effect.fn('OutputSearch.matches')(function* (
    run: SearchRun,
    query: ContentQuery,
    request: CommandSearchRequest,
    stream: OutputStream,
    base: { readonly line: number; readonly offset: bigint },
    skip: boolean,
    need: number,
  ) {
    const rows: Row[] = [];
    let last: { readonly line: number; readonly after: Line[] | null } | undefined;
    let pending: Line[] = [];
    let skipping = skip;
    const events = yield* ran(
      searchContent(run, { ...query, before: request.before, after: request.after, maxCount: skip ? need + 1 : need }),
    );
    for (const event of events) {
      if (event._tag !== 'Match' && event._tag !== 'Context') continue;
      if (event._tag === 'Match' && !skipping && rows.length === need) return { rows, beyond: true } satisfies Found;
      const line = base.line + event.line - 1;
      if (event._tag === 'Context') {
        const near = { line, text: clipped(event.text, 0) };
        if (last !== undefined && line - last.line <= request.after) last.after?.push(near);
        else pending.push(near);
        continue;
      }
      if (skipping) {
        skipping = false;
        last = { line, after: null };
        pending = [];
        continue;
      }
      const row: Row = {
        stream,
        line,
        offset: byteOffset(base.offset + BigInt(event.offset)),
        text: clipped(event.text, event.ranges[0]?.start ?? 0),
        before: pending,
        after: [],
      };
      rows.push(row);
      last = { line, after: row.after };
      pending = [];
    }
    return { rows, beyond: false } satisfies Found;
  });

  const windowed = Effect.fn('OutputSearch.windowed')(function* (
    run: SearchRun,
    query: ContentQuery,
    request: CommandSearchRequest,
    bound: Bound,
    file: string,
    start: { readonly line: number; readonly offset: bigint },
    skip: boolean,
    need: number,
  ) {
    for (let size = FIRST_WINDOW; ; size *= 2n) {
      const end = start.offset + size < bound.through ? start.offset + size : bound.through;
      const staged = yield* stage(request, bound, start.offset, end, file);
      if (staged === null) continue;
      const found = yield* matches(run, query, request, bound.stream, start, skip, need);
      const lastLine = start.line + staged.lines - 1;
      const tail = found.rows.at(-1);
      const settled =
        staged.through === bound.through ||
        found.beyond ||
        (found.rows.length === need && tail !== undefined && tail.line + request.after <= lastLine);
      if (settled) return found.rows;
    }
  });

  const search = Effect.fn('CommandReader.search')(function* (request: CommandSearchRequest) {
    const { execution } = request;
    const reading = yield* reader.one(request.projectId, execution.execution, execution.incarnation);
    const streams: readonly OutputStream[] = request.stream === undefined ? OUTPUT_STREAMS : [request.stream];
    const question: PageQuestion = {
      operation: 'search_output',
      order: 1,
      selection: {
        execution: execution.execution,
        incarnation: execution.incarnation,
        pattern: request.pattern,
        stream: request.stream,
        ignoreCase: request.ignoreCase === true,
        before: request.before,
        after: request.after,
      },
    };
    let resumed: Resume | undefined;
    if (request.cursor !== undefined) {
      const read = readCursor(request.cursor, question);
      if ('refused' in read) return yield* cursorRefusal(read.refused);
      resumed = resumeOf(read.at, streams) ?? undefined;
      if (resumed === undefined) return yield* cursorRefusal('bad-cursor');
    }
    const bounds =
      resumed?.bounds ??
      (yield* Effect.forEach(streams, (stream) =>
        Effect.map(
          commands.bytes({ ref: execution, stream, offset: ByteOffset.make('0') }, 0, request.authority, { withPositions: true }),
          (chunk) => ({
            stream,
            from: offsetValue(chunk.range.retainedFrom),
            through: offsetValue(chunk.range.durableThrough),
          }),
        ),
      ));
    const directory = yield* Effect.mapError(files.makeTempDirectoryScoped({ prefix: 'tagma-output-' }), (error) =>
      unstaged(error.message),
    );
    const run: SearchRun = { binary: yield* binary.path(), cwd: directory, platform: process.platform, ceilingMs: CEILING_MS };
    const query = (file: string): ContentQuery => ({ pattern: request.pattern, file, ignoreCase: request.ignoreCase, raw: true });
    const fileOf = (index: number) => path.join(directory, `${index}`);

    let total = resumed?.total ?? 0;
    if (resumed === undefined) {
      for (const [index, bound] of bounds.entries()) {
        if (bound.from >= bound.through) continue;
        yield* stage(request, bound, bound.from, bound.through, fileOf(index));
        total += yield* count(run, query(fileOf(index)));
      }
    }

    const rows: Row[] = [];
    const ordinal = resumed?.ordinal ?? 0;
    for (let index = resumed?.index ?? 0; index < bounds.length && rows.length < request.limit; index += 1) {
      const bound = bounds[index] as Bound;
      const here = resumed !== undefined && index === resumed.index ? resumed : undefined;
      const start = { line: here?.line ?? 1, offset: here?.offset ?? bound.from };
      if (start.offset >= bound.through) continue;
      const need = request.limit - rows.length;
      const found =
        resumed === undefined
          ? (yield* matches(run, query(fileOf(index)), request, bound.stream, start, false, need)).rows
          : yield* windowed(run, query(fileOf(index)), request, bound, fileOf(index), start, here !== undefined, need);
      rows.push(...found);
    }

    const shown = fitted(rows, request.budget);
    const last = shown.at(-1);
    const next =
      last !== undefined && ordinal + shown.length < total
        ? mintCursor(
            question,
            keyOf({
              index: streams.indexOf(last.stream),
              offset: offsetValue(last.offset),
              line: last.line,
              ordinal: ordinal + shown.length,
              total,
              bounds,
            }),
          )
        : null;
    return {
      execution,
      label: reading.command.label,
      commandLine: reading.command.commandLine,
      ...statusOf(reading),
      matches: shown satisfies readonly OutputMatch[],
      shown: shown.length,
      total,
      next,
      searched: bounds.map((bound) => ({ stream: bound.stream, from: byteOffset(bound.from), through: byteOffset(bound.through) })),
    } satisfies CommandSearchReading;
  }, Effect.scoped);

  return { search };
});
