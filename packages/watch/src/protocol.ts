import { Schema } from 'effect';

export const WatchChange = Schema.Struct({
  kind: Schema.Literals(['create', 'update', 'delete']),
  path: Schema.String,
  directory: Schema.optional(Schema.Boolean),
  heard: Schema.optional(Schema.Struct({ from: Schema.Number, to: Schema.Number })),
});
export type WatchChange = typeof WatchChange.Type;

const Id = Schema.Int;
const Ignore = Schema.Array(Schema.String);

export const WatchAsk = Schema.Union([
  Schema.Struct({ t: Schema.Literal('subscribe'), id: Id, at: Schema.String, recursive: Schema.Boolean, ignore: Ignore }),
  Schema.Struct({ t: Schema.Literal('unsubscribe'), id: Id }),
  Schema.Struct({ t: Schema.Literal('snapshot'), id: Id, at: Schema.String, snapshot: Schema.String, ignore: Ignore }),
  Schema.Struct({ t: Schema.Literal('since'), id: Id, at: Schema.String, snapshot: Schema.String, ignore: Ignore }),
  Schema.Struct({ t: Schema.Literal('cursor'), id: Id, at: Schema.String, ignore: Ignore }),
  Schema.Struct({ t: Schema.Literal('settle'), id: Id, at: Schema.String, ignore: Ignore }),
  Schema.Struct({ t: Schema.Literal('moved'), id: Id, at: Schema.String, cursor: Schema.String }),
  Schema.Struct({ t: Schema.Literal('retire'), id: Id }),
  Schema.Struct({ t: Schema.Literal('shutdown'), id: Id }),
]);
export type WatchAsk = typeof WatchAsk.Type;

export const WatchSaid = Schema.Union([
  Schema.Struct({ t: Schema.Literal('subscribed'), id: Id }),
  Schema.Struct({ t: Schema.Literal('unsubscribed'), id: Id }),
  Schema.Struct({ t: Schema.Literal('refused'), id: Id, reason: Schema.String }),
  Schema.Struct({ t: Schema.Literal('heard'), id: Id, changes: Schema.Array(WatchChange) }),
  Schema.Struct({ t: Schema.Literal('dropped'), id: Id, subtree: Schema.NullOr(Schema.String), reason: Schema.String }),
  Schema.Struct({ t: Schema.Literal('ended'), id: Id, reason: Schema.String }),
  Schema.Struct({ t: Schema.Literal('written'), id: Id }),
  Schema.Struct({ t: Schema.Literal('changed'), id: Id, changes: Schema.NullOr(Schema.Array(WatchChange)) }),
  Schema.Struct({ t: Schema.Literal('cursor'), id: Id, cursor: Schema.NullOr(Schema.String) }),
  Schema.Struct({ t: Schema.Literal('settled'), id: Id, settled: Schema.Boolean }),
  Schema.Struct({ t: Schema.Literal('moved'), id: Id, changes: Schema.NullOr(Schema.Array(WatchChange)) }),
  Schema.Struct({ t: Schema.Literal('done'), id: Id }),
]);
export type WatchSaid = typeof WatchSaid.Type;

export const decodeAsk = Schema.decodeUnknownResult(Schema.fromJsonString(WatchAsk));
export const decodeSaid = Schema.decodeUnknownResult(Schema.fromJsonString(WatchSaid));

export const READY = 'ready';

export const CHANGES_PER_LINE = 1000;

export type Outbox = { readonly push: (line: string) => void; readonly flush: () => void; readonly pending: () => number };

export const outbox = (write: (bytes: Uint8Array) => number): Outbox => {
  const queue: Uint8Array[] = [];
  let head = 0;
  let bytes = 0;
  const flush = (): void => {
    while (head < queue.length) {
      const next = queue[head]!;
      const wrote = Math.max(0, write(next));
      bytes -= Math.min(wrote, next.length);
      if (wrote < next.length) {
        queue[head] = next.subarray(wrote);
        return;
      }
      head += 1;
    }
    queue.length = 0;
    head = 0;
  };
  return {
    push: (line) => {
      const encoded = Buffer.from(line);
      queue.push(encoded);
      bytes += encoded.length;
      if (queue.length - head === 1) flush();
    },
    flush,
    pending: () => bytes,
  };
};

export const lines = (take: (line: string) => void) => {
  const decoder = new TextDecoder();
  let held = '';
  return (chunk: Uint8Array): void => {
    const parts = (held + decoder.decode(chunk, { stream: true })).split('\n');
    held = parts.pop() ?? '';
    for (const line of parts) if (line !== '') take(line);
  };
};
