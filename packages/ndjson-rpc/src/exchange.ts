import { Data, Duration, Effect, Schema, Stream } from 'effect';
import { classify, type Classified } from './envelope';
import { LineCutter, type Cut } from './cutter';
import { parseOffLoop } from './offLoop';

const LINE_CAP = 1024 * 1024;
const LOOP_BYTES = 1024 * 1024;
const NOTIFICATION_CAP = 400;

export class ExchangeVendorError extends Data.TaggedError('ExchangeVendorError')<{
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}> {}

export class ExchangeTimeout extends Data.TaggedError('ExchangeTimeout')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class ExchangeEof extends Data.TaggedError('ExchangeEof')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class ExchangeFailed extends Data.TaggedError('ExchangeFailed')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class ExchangeOversized extends Data.TaggedError('ExchangeOversized')<{
  readonly start: bigint;
  readonly ceiling: number;
}> {}

export type ExchangeError = ExchangeVendorError | ExchangeTimeout | ExchangeEof | ExchangeFailed;

export const ExchangeId = Schema.Union([Schema.String, Schema.Number]);
export type ExchangeId = Schema.Schema.Type<typeof ExchangeId>;

export const ExchangeRequestRecord = Schema.Struct({
  id: ExchangeId,
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});
export type ExchangeRequestRecord = Schema.Schema.Type<typeof ExchangeRequestRecord>;

export const ExchangeResponseRecord = Schema.Union([
  Schema.Struct({ id: ExchangeId, result: Schema.Unknown }),
  Schema.Struct({
    id: ExchangeId,
    error: Schema.Struct({ code: Schema.Number, message: Schema.String, data: Schema.optional(Schema.Unknown) }),
  }),
]);
export type ExchangeResponseRecord = Schema.Schema.Type<typeof ExchangeResponseRecord>;

export const ExchangeNotificationRecord = Schema.Struct({
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});
export type ExchangeNotificationRecord = Schema.Schema.Type<typeof ExchangeNotificationRecord>;

export const ExchangeTranscript = Schema.Struct({
  requests: Schema.Array(ExchangeRequestRecord),
  responses: Schema.Array(ExchangeResponseRecord),
  notifications: Schema.Array(ExchangeNotificationRecord),
  droppedNotifications: Schema.Number,
});
export type ExchangeTranscript = Schema.Schema.Type<typeof ExchangeTranscript>;

export type ExchangeRead = (offset: bigint) => Stream.Stream<Uint8Array, ExchangeFailed>;

export type ExchangePorts = {
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>;
  readonly read: ExchangeRead;
};

export type InboundFrom = { readonly offset: bigint; readonly torn: boolean };

export type Inbound = { readonly message: Classified; readonly start: bigint; readonly end: bigint };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type LineCut = Extract<Cut, { readonly _tag: 'Line' }>;

const offLoop = (cut: LineCut): Effect.Effect<Classified | null, ExchangeFailed> => {
  const owned =
    cut.owned && cut.bytes.byteOffset === 0 && cut.bytes.byteLength === cut.bytes.buffer.byteLength ? cut.bytes : cut.bytes.slice();
  return Effect.mapError(
    parseOffLoop(owned.buffer as ArrayBuffer),
    (gone) => new ExchangeFailed({ detail: `the ${cut.bytes.length}-byte line at byte ${cut.start} could not be parsed: ${gone.message}` }),
  );
};

const segments = (lines: ReadonlyArray<LineCut>): ReadonlyArray<ReadonlyArray<LineCut>> => {
  const out: Array<ReadonlyArray<LineCut>> = [];
  let group: Array<LineCut> = [];
  let bytes = 0;
  for (const line of lines) {
    if (group.length > 0 && (line.bytes.length > LOOP_BYTES || bytes + line.bytes.length > LOOP_BYTES)) {
      out.push(group);
      group = [];
      bytes = 0;
    }
    group.push(line);
    bytes += line.bytes.length;
  }
  if (group.length > 0) out.push(group);
  return out;
};

const parsed = (segment: ReadonlyArray<LineCut>): Effect.Effect<Array<Inbound>, ExchangeFailed> => {
  const only = segment[0]!;
  if (segment.length === 1 && only.bytes.length > LOOP_BYTES) {
    return Effect.map(offLoop(only), (classified) =>
      classified === null ? [] : [{ message: classified, start: only.start, end: only.end }],
    );
  }
  return Effect.sync(() =>
    segment.flatMap((line) => {
      const classified = classify(decoder.decode(line.bytes));
      return classified === null ? [] : [{ message: classified, start: line.start, end: line.end }];
    }),
  );
};

const received = (cuts: ReadonlyArray<Cut>, ceiling: number): Stream.Stream<Inbound, ExchangeFailed | ExchangeOversized> => {
  const last = cuts[cuts.length - 1];
  const lines = cuts.filter((cut): cut is LineCut => cut._tag === 'Line');
  const read = Stream.fromIterable(segments(lines)).pipe(Stream.flatMap((segment) => Stream.fromArrayEffect(parsed(segment))));
  return last?._tag === 'Over' ? Stream.concat(read, Stream.fail(new ExchangeOversized({ start: last.start, ceiling }))) : read;
};

export const inbound = (
  read: ExchangeRead,
  from: InboundFrom,
  ceiling: number,
): Stream.Stream<Inbound, ExchangeFailed | ExchangeOversized> =>
  read(from.offset).pipe(
    Stream.mapAccum(
      () => new LineCutter(from.offset, from.torn, ceiling),
      (cutter, chunk) => {
        const cuts = cutter.cut(chunk);
        return [cutter, cuts.length === 0 ? [] : [cuts]] as const;
      },
    ),
    Stream.flatMap((cuts) => received(cuts, ceiling)),
  );

export const makeExchange = ({ read, write }: ExchangePorts) => {
  let next = 1;
  let offset = 0n;
  let outstanding = false;
  const sent: Array<ExchangeRequestRecord> = [];
  const answered: Array<ExchangeResponseRecord> = [];
  const notices: Array<ExchangeNotificationRecord> = [];
  let dropped = 0;

  const consume = Effect.fn('JsonRpcExchange.consume')(function* (id: number, method: string) {
    let terminal: Inbound | undefined;
    let consumed = 0;
    yield* inbound(read, { offset, torn: false }, LINE_CAP).pipe(
      Stream.catchTag('ExchangeOversized', (over) =>
        Stream.fail(
          new ExchangeFailed({ detail: `${method} (id ${id}) met a line past the ${over.ceiling}-byte cap at byte ${over.start}` }),
        ),
      ),
      Stream.runForEachWhile((item) =>
        Effect.sync(() => {
          if (item.message._tag !== 'Notification') {
            terminal = item;
            return false;
          }
          consumed += 1;
          offset = item.end;
          if (notices.length < NOTIFICATION_CAP) {
            notices.push({
              method: item.message.method,
              params: item.message.params,
            });
          } else dropped += 1;
          return true;
        }),
      ),
    );
    if (terminal === undefined) {
      return yield* new ExchangeEof({ detail: `${method} (id ${id}) ended with the stream; ${consumed} line(s) consumed` });
    }
    const end = terminal;
    const message = end.message;
    if (message._tag === 'Malformed') {
      return yield* new ExchangeFailed({ detail: `${method} (id ${id}) met ${message.problem}: ${message.excerpt}` });
    }
    if (message._tag === 'Request' || message._tag === 'Notification') {
      return yield* new ExchangeFailed({
        detail: `${method} (id ${id}) met a request ${message.method} from the server, which this exchange does not answer`,
      });
    }
    if (message._tag === 'Error' && message.id === null) {
      return yield* new ExchangeFailed({ detail: `${method} (id ${id}) met an error response for id null: ${message.error.message}` });
    }
    if (message._tag === 'Result') answered.push({ id: message.id, result: message.result });
    else if (message.id !== null) answered.push({ id: message.id, error: message.error });
    if (message.id !== id) {
      return yield* new ExchangeFailed({ detail: `${method} (id ${id}) met a response for id ${JSON.stringify(message.id)}` });
    }
    offset = end.end;
    if (message._tag === 'Error') {
      return yield* new ExchangeVendorError({
        code: message.error.code,
        message: message.error.message,
        data: message.error.data,
      });
    }
    return message.result;
  });

  return {
    get transcript(): ExchangeTranscript {
      return {
        requests: [...sent],
        responses: [...answered],
        notifications: [...notices],
        droppedNotifications: dropped,
      };
    },
    request: (method: string, params?: unknown, timeoutMs?: number): Effect.Effect<unknown, ExchangeError> =>
      Effect.acquireUseRelease(
        Effect.suspend(() => {
          if (outstanding) {
            return Effect.fail(new ExchangeFailed({ detail: `${method} was refused: another request is still outstanding` }));
          }
          outstanding = true;
          return Effect.void;
        }),
        () =>
          Effect.gen(function* () {
            const id = next++;
            const framed = `${JSON.stringify({ id, method, params })}\n`;
            yield* write(encoder.encode(framed));
            sent.push({ id, method, params });
            const waiting = consume(id, method);
            return yield* timeoutMs === undefined
              ? waiting
              : waiting.pipe(
                  Effect.timeout(Duration.millis(timeoutMs)),
                  Effect.catchTag('TimeoutError', () =>
                    Effect.fail(new ExchangeTimeout({ detail: `${method} (id ${id}) had no answer inside ${timeoutMs}ms` })),
                  ),
                );
          }),
        () =>
          Effect.sync(() => {
            outstanding = false;
          }),
      ).pipe(Effect.withSpan('JsonRpcExchange.request')),
  };
};
