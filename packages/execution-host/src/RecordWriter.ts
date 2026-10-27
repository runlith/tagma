import { Data, Deferred, Duration, Effect, Exit, Fiber, FileSystem, Path, PlatformError, Result, Schema, Scope } from 'effect';
import { SHUTDOWN_PHASE_MS } from '@runlith/executions/protocol/capacity';
import {
  CRC32_INITIAL,
  MAX_RECORD_OFFSET,
  RecordNameInvalid,
  crc32Update,
  readSegmentHeader,
  segmentPosition,
  type JournalDelta,
  RecordWriteAction,
  SEAL_FILE,
  SEGMENT_HEADER_BYTES,
  encodeSegmentHeader,
  recordFolder,
  sealCodec,
  segmentFile,
  streamsOf,
  type RecordSeal,
} from '@runlith/executions/recordFormat';
import type { ExecutionRef, Transport } from '@runlith/executions/protocol/execution';
import { Stream, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { JournalInvalid, makeRecordJournal } from './RecordJournal';

export const OUTPUT_FILE = 'output.log';

export type RecordOptions = {
  readonly actMs?: number;
  readonly grid?: TerminalGeometry;
  readonly streaming?: ReadonlyArray<Stream>;
};

export type RecordSegment = {
  readonly first: bigint;
  readonly end: bigint;
  readonly register: number;
};

export class RecordWriteFailed extends Data.TaggedError('RecordWriteFailed')<{
  readonly stream?: typeof Stream.Type | undefined;
  readonly act: typeof RecordWriteAction.Type;
  readonly detail: string;
  readonly exhausted?: boolean | undefined;
}> {
  override get message(): string {
    return this.detail;
  }
}

const exhaustedHandles = (error: PlatformError.PlatformError): boolean => {
  const cause = (error.reason as { readonly cause?: { readonly code?: unknown } }).cause;
  return cause?.code === 'EMFILE' || cause?.code === 'ENFILE' || /\bE(M|N)FILE\b/.test(error.message);
};

const writeFailure = (stream: Stream, error: PlatformError.PlatformError) =>
  new RecordWriteFailed({ stream, act: 'open', detail: error.message, exhausted: exhaustedHandles(error) });

type OpenSegment = {
  readonly handle: FileSystem.File;
  readonly scope: Scope.Closeable;
  readonly first: bigint;
};

type Opening = {
  readonly records: string;
  readonly ref: ExecutionRef;
  readonly transport: Transport;
  readonly actMs?: number;
} & (
  | { readonly mode: 'create'; readonly grid?: TerminalGeometry; readonly streaming?: ReadonlyArray<Stream> }
  | { readonly mode: 'reopen' }
);

type Wait = <A>(
  stream: Stream,
  act: typeof RecordWriteAction.Type,
  carrier: Effect.Effect<A, RecordWriteFailed>,
) => Effect.Effect<A, RecordWriteFailed>;

const encodeSeal = Schema.encodeEffect(sealCodec);
const ACT_MS = SHUTDOWN_PHASE_MS;

const journalFailure = <A, R>(act: Effect.Effect<A, PlatformError.PlatformError | Schema.SchemaError | JournalInvalid, R>) =>
  Effect.mapError(
    act,
    (error) =>
      new RecordWriteFailed({
        act: 'journal',
        detail: error._tag === 'JournalInvalid' ? error.detail : error.message,
        exhausted: error._tag === 'PlatformError' ? exhaustedHandles(error) : undefined,
      }),
  );

export const recordDescriptors = (transport: Transport): number => streamsOf(transport).length + 1;

export const makeRecordWriter = Effect.fnUntraced(function* (opening: Opening) {
  const { records, ref, transport } = opening;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = recordFolder(ref.execution);
  if (folder instanceof RecordNameInvalid) return yield* folder;
  const scope = yield* Scope.fork(yield* Effect.scope);
  const directory = path.join(records, folder);
  const streams = streamsOf(transport);
  const actMs = opening.actMs ?? ACT_MS;
  if (opening.mode === 'create') {
    for (const place of [directory, ...streams.map((stream) => path.join(directory, stream))]) {
      yield* fs
        .makeDirectory(place, { recursive: true, mode: 0o700 })
        .pipe(Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ act: 'directory', detail: error.message })));
    }
  }
  const journal = yield* makeRecordJournal(
    opening.mode === 'create'
      ? { mode: 'create', directory, ref, transport, grid: opening.grid, streaming: opening.streaming }
      : { mode: 'reopen', directory, ref, transport },
  ).pipe(journalFailure);
  const open = new Map<Stream, OpenSegment>();
  const patience = new Map(streams.map((stream) => [stream, Deferred.makeUnsafe<void>()] as const));

  const settled = <A>(stream: Stream, act: typeof RecordWriteAction.Type, answering: Fiber.Fiber<A, RecordWriteFailed>) =>
    Effect.flatMap(Effect.raceFirst(Fiber.await(answering), Effect.as(Effect.sleep(Duration.millis(actMs)), undefined)), (answer) =>
      answer !== undefined
        ? answer
        : new RecordWriteFailed({ stream, act, detail: `the record carrier did not answer ${act} within ${actMs}ms` }),
    );

  const carried = <A>(
    carrier: Effect.Effect<A, RecordWriteFailed>,
    waiting: (answering: Fiber.Fiber<A, RecordWriteFailed>) => Effect.Effect<A, RecordWriteFailed>,
  ) =>
    Effect.flatMap(Effect.forkDetach(carrier, { startImmediately: true }), (answering) =>
      Effect.ensuring(
        waiting(answering),
        Effect.sync(() => answering.interruptUnsafe()),
      ),
    );

  const bounded: Wait = (stream, act, carrier) => carried(carrier, (answering) => settled(stream, act, answering));

  const answered: Wait = (stream, act, carrier) =>
    Effect.suspend(() => {
      const hurried = patience.get(stream);
      if (hurried === undefined || Deferred.isDoneUnsafe(hurried)) return bounded(stream, act, carrier);
      return carried(carrier, (answering) =>
        Effect.flatMap(Effect.exit(Effect.interruptible(Effect.raceFirst(Fiber.await(answering), Deferred.await(hurried)))), (first) =>
          Exit.isSuccess(first) && first.value !== undefined ? first.value : settled(stream, act, answering),
        ),
      );
    });

  const hurry = (stream?: Stream): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const [held, hurried] of patience) if (stream === undefined || held === stream) Deferred.doneUnsafe(hurried, Effect.void);
    });

  const segmentPath = (stream: Stream, first: bigint): string => path.join(directory, stream, segmentFile(first));

  const journalEntry = (entry: JournalDelta, wait: Wait): Effect.Effect<void, RecordWriteFailed> =>
    wait(entry._tag === 'Grid' ? 'pty' : entry.stream, 'journal', journal.append(entry).pipe(journalFailure));

  const reopenSegment = Effect.fnUntraced(
    function* (stream: Stream, first: bigint, segmentBytes: number, landingBytes: number) {
      const file = segmentPath(stream, first);
      if (!(yield* fs.exists(file))) {
        yield* openSegment(stream, first, bounded);
        return { first, end: first, register: CRC32_INITIAL };
      }
      const own = yield* Scope.fork(scope);
      const handle = yield* fs.open(file, { flag: 'r+' }).pipe(Scope.provide(own));
      const size = (yield* handle.stat).size;
      const length = size - BigInt(SEGMENT_HEADER_BYTES);
      if (length < 0n) {
        const expected = encodeSegmentHeader(stream, first);
        if ('defect' in expected) return yield* new RecordWriteFailed({ stream, act: 'segment', detail: expected.detail });
        const prefix = new Uint8Array(Number(size));
        let taken = 0;
        while (taken < prefix.length) {
          const read = yield* handle.read(prefix.subarray(taken));
          if (read === 0)
            return yield* new RecordWriteFailed({ stream, act: 'segment', detail: 'the unfinished header changed while opening' });
          taken += read;
        }
        if (prefix.some((byte, index) => byte !== expected[index])) {
          return yield* new RecordWriteFailed({
            stream,
            act: 'segment',
            detail: 'the unfinished header differs from its journal frontier',
          });
        }
        yield* handle.seek(0n, 'start');
        yield* handle.writeAll(expected);
        open.set(stream, { handle, scope: own, first });
        return { first, end: first, register: CRC32_INITIAL };
      }
      if (length > BigInt(segmentBytes) || first + length > MAX_RECORD_OFFSET) {
        return yield* new RecordWriteFailed({
          stream,
          act: 'segment',
          detail: `open segment spans ${first}..${first + length}, payload limit ${segmentBytes}, last record offset ${MAX_RECORD_OFFSET}`,
        });
      }
      const header = new Uint8Array(SEGMENT_HEADER_BYTES);
      let received = 0;
      while (received < header.length) {
        const read = yield* handle.read(header.subarray(received));
        if (read === 0) return yield* new RecordWriteFailed({ stream, act: 'segment', detail: 'the open segment header is short' });
        received += read;
      }
      const declared = readSegmentHeader(header);
      if ('defect' in declared || declared.first !== first || declared.stream !== stream) {
        return yield* new RecordWriteFailed({
          stream,
          act: 'segment',
          detail: 'defect' in declared ? declared.detail : 'the open segment names another stream or offset',
        });
      }
      const buffer = new Uint8Array(Math.min(landingBytes, Math.max(1, Number(length))));
      let register = CRC32_INITIAL;
      let taken = 0n;
      while (taken < length) {
        const read = yield* handle.read(buffer.subarray(0, Number(min(BigInt(buffer.length), length - taken))));
        if (read === 0) return yield* new RecordWriteFailed({ stream, act: 'segment', detail: 'the open segment payload is short' });
        register = crc32Update(register, buffer.subarray(0, read));
        taken += BigInt(read);
      }
      yield* handle.seek(segmentPosition(first, first + length), 'start');
      open.set(stream, { handle, scope: own, first });
      return { first, end: first + length, register };
    },
    (effect, stream) => bounded(stream, 'open', effect.pipe(Effect.catchTag('PlatformError', (error) => writeFailure(stream, error)))),
  );

  const openSegment = Effect.fnUntraced(function* (stream: Stream, first: bigint, wait: Wait) {
    if (open.has(stream)) return yield* new RecordWriteFailed({ stream, act: 'open', detail: 'a segment is already open on this stream' });
    const header = encodeSegmentHeader(stream, first);
    if ('defect' in header) return yield* new RecordWriteFailed({ stream, act: 'segment', detail: header.detail });
    const file = segmentPath(stream, first);
    const own = yield* Scope.fork(scope);
    const handle = yield* wait(
      stream,
      'open',
      fs.open(file, { flag: 'wx', mode: 0o600 }).pipe(
        Scope.provide(own),
        Effect.catchTag('PlatformError', (error) => writeFailure(stream, error)),
      ),
    ).pipe(Effect.onError(() => Scope.close(own, Exit.void)));
    yield* wait(
      stream,
      'open',
      handle.writeAll(header).pipe(Effect.catchTag('PlatformError', (error) => writeFailure(stream, error))),
    ).pipe(
      Effect.onError(() =>
        Scope.close(own, Exit.void).pipe(Effect.andThen(Effect.ignore(Effect.timeoutOption(fs.remove(file), Duration.millis(actMs))))),
      ),
    );
    open.set(stream, { handle, scope: own, first });
  }, Effect.uninterruptible);

  const append = (stream: Stream, payload: Uint8Array, wait: Wait): Effect.Effect<void, RecordWriteFailed> =>
    Effect.suspend(() => {
      const segment = open.get(stream);
      if (segment === undefined) return new RecordWriteFailed({ stream, act: 'append', detail: 'no segment is open' });
      return wait(
        stream,
        'append',
        segment.handle
          .writeAll(payload)
          .pipe(Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ stream, act: 'append', detail: error.message }))),
      );
    });

  const truncateSegment = (stream: Stream, bytes: bigint, wait: Wait): Effect.Effect<void, RecordWriteFailed> =>
    Effect.suspend(() => {
      const segment = open.get(stream);
      if (segment === undefined) return new RecordWriteFailed({ stream, act: 'truncate', detail: 'no segment is open' });
      return wait(
        stream,
        'truncate',
        segment.handle
          .truncate(Number(BigInt(SEGMENT_HEADER_BYTES) + bytes))
          .pipe(Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ stream, act: 'truncate', detail: error.message }))),
      );
    });

  const sync = (stream: Stream, wait: Wait): Effect.Effect<void, RecordWriteFailed> =>
    Effect.suspend(() => {
      const segment = open.get(stream);
      if (segment === undefined) return Effect.void;
      return wait(
        stream,
        'sync',
        segment.handle.sync.pipe(
          Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ stream, act: 'sync', detail: error.message })),
        ),
      );
    });

  const closeSegment = Effect.fnUntraced(function* (stream: Stream, wait: Wait) {
    const segment = open.get(stream);
    if (segment === undefined) return;
    const flushed = yield* Effect.result(sync(stream, wait));
    yield* Scope.close(segment.scope, Exit.void);
    open.delete(stream);
    if (Result.isFailure(flushed)) return yield* flushed.failure;
  }, Effect.uninterruptible);

  const dropSegment = (stream: Stream, first: bigint, wait: Wait): Effect.Effect<void, RecordWriteFailed> =>
    wait(
      stream,
      'drop',
      fs.remove(segmentPath(stream, first)).pipe(
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.void),
        Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ stream, act: 'drop', detail: error.message })),
      ),
    );

  const keptPath = path.join(directory, OUTPUT_FILE);

  const keepOutput = (segments: ReadonlyArray<RecordSegment>, from: bigint): Effect.Effect<string, RecordWriteFailed> => {
    const draft = `${keptPath}.next`;
    const failed = (detail: string) => new RecordWriteFailed({ stream: 'output', act: 'segment', detail });
    const copy = Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(draft, { flag: 'w', mode: 0o600 });
        for (const segment of segments) {
          const first = segment.first > from ? segment.first : from;
          if (segment.end <= first) continue;
          const bytes = yield* fs.readFile(segmentPath('output', segment.first));
          const end = Number(segmentPosition(segment.first, segment.end));
          if (bytes.length < end)
            return yield* failed(`segment ${segment.first} holds ${bytes.length} of the ${end} bytes its bounds name`);
          yield* file.writeAll(bytes.subarray(Number(segmentPosition(segment.first, first)), end));
        }
      }),
    ).pipe(
      Effect.andThen(fs.rename(draft, keptPath)),
      Effect.as(keptPath),
      Effect.catchTag('PlatformError', (error) => failed(error.message)),
    );
    return bounded('output', 'segment', copy);
  };

  const keptOutput: Effect.Effect<string | undefined, RecordWriteFailed> = bounded(
    'output',
    'open',
    fs.exists(keptPath).pipe(
      Effect.map((standing) => (standing ? keptPath : undefined)),
      Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ stream: 'output', act: 'open', detail: error.message })),
    ),
  );

  const writeSeal = Effect.fnUntraced(function* (seal: RecordSeal) {
    const text = yield* encodeSeal(seal).pipe(
      Effect.catchTag('SchemaError', (error) => new RecordWriteFailed({ act: 'seal', detail: error.message })),
    );
    const target = path.join(directory, SEAL_FILE);
    const draft = path.join(directory, `${SEAL_FILE}.${yield* Effect.sync(() => crypto.randomUUID())}`);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fs.open(draft, { flag: 'wx', mode: 0o600 });
        yield* handle.writeAll(new TextEncoder().encode(text));
        yield* handle.sync;
      }),
    ).pipe(
      Effect.andThen(fs.link(draft, target)),
      Effect.ensuring(Effect.ignore(fs.remove(draft))),
      Effect.catchTag('PlatformError', (error) => new RecordWriteFailed({ act: 'seal', detail: error.message })),
    );
  });

  if (opening.mode === 'reopen') {
    for (const { stream, from } of journal.retained) {
      if (BigInt(from) === 0n) continue;
      const files = yield* bounded(
        stream,
        'drop',
        fs
          .readDirectory(path.join(directory, stream))
          .pipe(Effect.mapError((error) => new RecordWriteFailed({ stream, act: 'drop', detail: error.message }))),
      );
      for (const file of files) {
        if (/^\d{20}\.seg$/.test(file)) {
          const first = BigInt(file.slice(0, -4));
          if (first < BigInt(from)) yield* dropSegment(stream, first, bounded);
        }
      }
    }
  }

  return {
    journal,
    directory,
    streams,
    get handles() {
      return open.size;
    },
    hurry,
    capturing: {
      journalEntry: (entry: JournalDelta) => journalEntry(entry, answered),
      openSegment: (stream: Stream, first: bigint) => openSegment(stream, first, answered),
      append: (stream: Stream, payload: Uint8Array) => append(stream, payload, answered),
      truncateSegment: (stream: Stream, bytes: bigint) => truncateSegment(stream, bytes, answered),
      closeSegment: (stream: Stream) => closeSegment(stream, answered),
      dropSegment: (stream: Stream, first: bigint) => dropSegment(stream, first, answered),
    },
    journalEntry: (entry: JournalDelta) => journalEntry(entry, bounded),
    reopenSegment,
    openSegment: (stream: Stream, first: bigint) => openSegment(stream, first, bounded),
    closeSegment: (stream: Stream) => closeSegment(stream, bounded),
    writeSeal,
    keepOutput,
    keptOutput,
  };
});

export type RecordWriter = Effect.Success<ReturnType<typeof makeRecordWriter>>;

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
