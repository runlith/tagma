import { Context, Data, Layer, Predicate, Result, Schema } from 'effect';
import { degradedReads } from '../agent/contracts';
import { THREAD_CORE_ENTRIES, type ThreadEntry } from './entries';
import { ThreadRewindMark } from './eventFold';
import type { ThreadProductEntry, ThreadTranscriptEntry } from './rows';

export type ThreadEntryKind = {
  readonly type: string;
  readonly schema: Schema.Codec<ThreadProductEntry, unknown>;
};

export class ThreadEntryUndecodable extends Data.TaggedError('ThreadEntryUndecodable')<{
  readonly type: string | null;
  readonly id: string | null;
  readonly issue: string;
}> {
  override get message(): string {
    return `Transcript entry ${this.id ?? '(no id)'} of kind ${this.type ?? '(no kind)'} cannot be read: ${this.issue}`;
  }
}

export class ThreadEntryUnreadable {
  readonly type = 'entry-unreadable';
  readonly id: string;
  readonly runId?: string;
  readonly occurredAt?: string;
  readonly rewound?: ThreadProductEntry['rewound'];
  //! An own member: a fold's spread of this entry must still store the record it stands for.
  readonly toJSON = function (this: ThreadEntryUnreadable): unknown {
    if (this.stored === null)
      return { type: this.type, id: this.id, runId: this.runId, occurredAt: this.occurredAt, rewound: this.rewound };
    if (this.rewound === this.readMark) return this.stored;
    const { rewound: _standing, ...body } = this.stored;
    return this.rewound === undefined ? body : { ...body, rewound: this.rewound };
  };
  readonly readMark?: ThreadProductEntry['rewound'];

  constructor(
    entry: ThreadProductEntry,
    readonly refusal: ThreadEntryUndecodable,
    readonly stored: Held | null = null,
  ) {
    this.id = entry.id;
    this.runId = entry.runId;
    this.occurredAt = entry.occurredAt;
    this.rewound = entry.rewound;
    this.readMark = entry.rewound;
  }

  static is(entry: ThreadTranscriptEntry): entry is ThreadEntryUnreadable {
    return entry.type === 'entry-unreadable' && 'refusal' in entry && entry.refusal instanceof ThreadEntryUndecodable;
  }
}

const entryIdentity = Schema.Struct({
  type: Schema.String,
  id: Schema.NonEmptyString,
  runId: Schema.optional(Schema.Unknown),
  occurredAt: Schema.optional(Schema.Unknown),
  rewound: Schema.optional(Schema.Unknown),
});
const readEntryIdentity = Schema.decodeUnknownResult(entryIdentity);
const readIdentityText = Schema.decodeUnknownResult(Schema.String);
const readIdentityMark = Schema.decodeUnknownResult(ThreadRewindMark);

export const unreadableEntry = (
  value: unknown,
  refusal: ThreadEntryUndecodable,
  stored: Held | null = null,
): ThreadEntryUnreadable | null => {
  const identity = readEntryIdentity(value);
  if (Result.isFailure(identity)) return null;
  const runId = readIdentityText(identity.success.runId);
  const occurredAt = readIdentityText(identity.success.occurredAt);
  const rewound = readIdentityMark(identity.success.rewound);
  return new ThreadEntryUnreadable(
    {
      type: identity.success.type,
      id: identity.success.id,
      runId: Result.isSuccess(runId) ? runId.success : undefined,
      occurredAt: Result.isSuccess(occurredAt) ? occurredAt.success : undefined,
      rewound: Result.isSuccess(rewound) ? rewound.success : undefined,
    },
    refusal,
    stored,
  );
};

export const crossingEntry = (entry: ThreadTranscriptEntry): ThreadTranscriptEntry =>
  ThreadEntryUnreadable.is(entry) ? (entry.toJSON() as ThreadTranscriptEntry) : entry;

const CORE_KINDS: readonly ThreadEntryKind[] = THREAD_CORE_ENTRIES.map((schema) => ({ type: schema.fields.type.schema.literal, schema }));

const CORE_TYPES: ReadonlySet<string> = new Set(CORE_KINDS.map((kind) => kind.type));

export function coreKind(type: string): boolean {
  return CORE_TYPES.has(type);
}

export function coreEntry(entry: ThreadTranscriptEntry): entry is ThreadEntry {
  return CORE_TYPES.has(entry.type);
}

export function generatedEntry(entry: ThreadTranscriptEntry): boolean {
  if (!coreEntry(entry)) return false;
  return entry.type === 'reasoning' || entry.type === 'tool' || (entry.type === 'message' && entry.role === 'assistant');
}

export function entryOf<const Type extends ThreadEntry['type']>(
  type: Type,
): (entry: ThreadTranscriptEntry) => entry is Extract<ThreadEntry, { readonly type: Type }> {
  return (entry): entry is Extract<ThreadEntry, { readonly type: Type }> => entry.type === type;
}

type Reader = (value: unknown) => Result.Result<ThreadTranscriptEntry, Schema.SchemaError>;

type Wire = {
  readonly read: Reader;
  readonly write: (entry: ThreadTranscriptEntry) => Result.Result<unknown, Schema.SchemaError>;
};

type Held = Readonly<Record<string, unknown>>;

export type ThreadFormRecord = 'entry' | 'payload' | 'message' | 'reading' | 'meta' | 'inbox';

export type ThreadFormForms = { readonly [record in ThreadFormRecord]?: (held: Held) => Held | null };

export type ThreadFormStep = {
  readonly name: string;
  readonly samples: Readonly<Partial<Record<ThreadFormRecord, Held>>>;
  readonly back?: ThreadFormForms | undefined;
} & ThreadFormForms;

export const reversed = (step: ThreadFormStep): ThreadFormStep => ({ name: step.name, samples: {}, ...step.back });

export type ThreadFormBase = { readonly step: string; readonly release: string };

export class ThreadFormRefused extends Data.TaggedError('ThreadFormRefused')<{
  readonly step: string;
  readonly issue: string;
}> {
  override get message(): string {
    return `Form step ${this.step} cannot form this record: ${this.issue}`;
  }
}

const isHeld = (value: unknown): value is Held => typeof value === 'object' && value !== null && !Array.isArray(value);

const identified = (value: unknown): { readonly type: string | null; readonly id: string | null } => {
  const shape = isHeld(value) ? value : {};
  return { type: typeof shape.type === 'string' ? shape.type : null, id: typeof shape.id === 'string' ? shape.id : null };
};

const stepped = (step: ThreadFormStep, record: ThreadFormRecord, value: unknown): unknown => {
  const form = step[record];
  if (form === undefined || !isHeld(value)) return value;
  try {
    return form(value) ?? value;
  } catch (failure) {
    if (failure instanceof ThreadFormRefused) throw failure;
    throw new ThreadFormRefused({ step: step.name, issue: failure instanceof Error ? failure.message : String(failure) });
  }
};

const steppedMessages = (step: ThreadFormStep, messages: unknown): unknown => {
  if (!Array.isArray(messages)) return messages;
  const formed = messages.map((message: unknown) => stepped(step, 'message', message));
  return formed.every((message, at) => message === messages[at]) ? messages : formed;
};

const steppedEvent = (step: ThreadFormStep, payload: unknown): unknown => {
  const formed = stepped(step, 'payload', payload);
  if (!isHeld(formed) || (step.entry === undefined && step.message === undefined)) return formed;
  const next: Record<string, unknown> = { ...formed };
  if (formed.entry !== undefined) next.entry = stepped(step, 'entry', formed.entry);
  if (formed.messages !== undefined) next.messages = steppedMessages(step, formed.messages);
  if (isHeld(formed.compacted)) {
    const messages = steppedMessages(step, formed.compacted.messages);
    if (messages !== formed.compacted.messages) next.compacted = { ...formed.compacted, messages };
  }
  if (isHeld(formed.restored) && Array.isArray(formed.restored.inserts)) {
    const inserts = (formed.restored.inserts as unknown[]).map((insert) => {
      if (!isHeld(insert)) return insert;
      const messages = steppedMessages(step, insert.messages);
      return messages === insert.messages ? insert : { ...insert, messages };
    });
    if (inserts.some((insert, at) => insert !== (formed.restored as { inserts: unknown[] }).inserts[at])) {
      next.restored = { ...formed.restored, inserts };
    }
  }
  return Object.keys(next).every((key) => next[key] === formed[key]) ? formed : next;
};

const refusable = (form: () => unknown): Result.Result<unknown, ThreadFormRefused> => {
  try {
    return Result.succeed(form());
  } catch (failure) {
    if (failure instanceof ThreadFormRefused) return Result.fail(failure);
    throw failure;
  }
};

type ThreadEntryProducts = readonly ThreadEntryKind[] | (() => readonly ThreadEntryKind[]);

export type ThreadReaderInput = {
  readonly products: ThreadEntryProducts;
  readonly steps?: readonly ThreadFormStep[];
  readonly base?: ThreadFormBase | null;
  readonly worker?: ThreadReaderWorker;
};

export type ThreadReaderWorker = () => Worker;

export type ThreadEntryReader = ReturnType<typeof makeThreadEntryReader>;

type KindTable = {
  readonly reader: (type: string) => Reader | undefined;
  readonly wire: (type: string) => Wire | undefined;
};

const tableOf = (products: readonly ThreadEntryKind[]): KindTable => {
  const readers = new Map<string, Reader>();
  const schemas = new Map<string, ThreadEntryKind['schema']>();
  for (const kind of [...CORE_KINDS, ...products]) {
    if (readers.has(kind.type)) throw new Error(`Transcript entry kind ${kind.type} is declared twice.`);
    const decode = Schema.decodeUnknownResult(kind.schema);
    readers.set(kind.type, (value) => decode(value, { onExcessProperty: 'error' }));
    schemas.set(kind.type, kind.schema);
  }
  const wires = new Map<string, Wire>();
  return {
    reader: (type) => readers.get(type),
    wire: (type) => {
      const held = wires.get(type);
      if (held !== undefined) return held;
      const schema = schemas.get(type);
      if (schema === undefined) return undefined;
      const json = Schema.toCodecJson(schema);
      const decode = Schema.decodeUnknownResult(json);
      const encode = Schema.encodeUnknownResult(json);
      const wire: Wire = {
        read: (value) => decode(value, { onExcessProperty: 'error' }),
        write: (entry) => encode(entry, { onExcessProperty: 'error' }),
      };
      wires.set(type, wire);
      return wire;
    },
  };
};

const tablesOf = (products: ThreadEntryProducts): (() => KindTable) => {
  if (typeof products !== 'function') {
    const fixed = tableOf(products);
    return () => fixed;
  }
  let standing: { readonly products: readonly ThreadEntryKind[]; readonly table: KindTable } | undefined;
  return () => {
    const current = products();
    if (standing?.products !== current) standing = { products: current, table: tableOf(current) };
    return standing.table;
  };
};

export const makeThreadEntryReader = ({ products, steps = [], base = null, worker: start }: ThreadReaderInput) => {
  const worker: ThreadReaderWorker | null = start ?? null;
  const table = tablesOf(products);
  const wireOf = (type: string | null): Wire | undefined => (type === null ? undefined : table().wire(type));
  const last = steps.at(-1)?.name ?? base?.step ?? null;
  const after = (mark: string | null): readonly ThreadFormStep[] => (mark === null ? steps : steps.filter((step) => step.name > mark));
  const lags = (mark: string | null): boolean => last !== null && (mark === null || mark < last);
  const below = (mark: string | null): boolean => base !== null && (mark === null || mark < base.step);
  const formed = (record: ThreadFormRecord, value: unknown, through: readonly ThreadFormStep[] = steps): unknown => {
    let current = value;
    for (const step of through) current = stepped(step, record, current);
    return current;
  };
  const formedEvent = (payload: unknown, through: readonly ThreadFormStep[] = steps): unknown => {
    let current = payload;
    for (const step of through) current = steppedEvent(step, current);
    return current;
  };
  const form = (record: ThreadFormRecord, value: unknown): Result.Result<unknown, ThreadFormRefused> =>
    steps.length === 0 ? Result.succeed(value) : refusable(() => formed(record, value));
  const formEvent = (payload: unknown): Result.Result<unknown, ThreadFormRefused> =>
    steps.length === 0 ? Result.succeed(payload) : refusable(() => formedEvent(payload));
  const decode = (value: unknown): Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable> => {
    const current = form('entry', value);
    if (Result.isFailure(current)) return Result.fail(new ThreadEntryUndecodable({ ...identified(value), issue: current.failure.message }));
    return read(current.success);
  };
  const read = (formed: unknown): Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable> => {
    if (Predicate.isObject(formed) && ThreadEntryUnreadable.is(formed as ThreadTranscriptEntry))
      return Result.fail((formed as unknown as ThreadEntryUnreadable).refusal);
    const { type, id } = identified(formed);
    const reader = type === null ? undefined : table().reader(type);
    if (reader === undefined) return Result.fail(new ThreadEntryUndecodable({ type, id, issue: 'no installed kind reads it' }));
    const result = reader(formed);
    return Result.isSuccess(result)
      ? Result.succeed(result.success)
      : Result.fail(new ThreadEntryUndecodable({ type, id, issue: result.failure.message }));
  };
  const { degraded, witnessing } = degradedReads();
  const carrying = (thread: string | null, value: unknown, read: Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable>) => {
    if (Result.isSuccess(read)) return read;
    if (Predicate.isObject(value) && ThreadEntryUnreadable.is(value as ThreadTranscriptEntry))
      return Result.succeed(value as unknown as ThreadTranscriptEntry);
    const carried = isHeld(value) ? unreadableEntry(value, read.failure, value) : null;
    if (carried === null) return read;
    degraded({
      thread,
      place: 'thread entry',
      why: 'a stored entry this build cannot read stands in the thread as a diagnostic line, its stored body kept',
      repeat: `${read.failure.type}\n${read.failure.issue}`,
      failure: new Error(`Transcript entries of kind ${read.failure.type ?? '(no kind)'} cannot be read: ${read.failure.issue}`, {
        cause: read.failure,
      }),
    });
    return Result.succeed<ThreadTranscriptEntry>(carried);
  };
  const stored = (thread: string | null, value: unknown): Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable> =>
    carrying(thread, value, decode(value));
  const storedForm = (thread: string | null, formed: unknown): Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable> =>
    carrying(thread, formed, read(formed));
  const readWire = (value: unknown): Result.Result<ThreadTranscriptEntry, ThreadEntryUndecodable> => {
    const { type, id } = identified(value);
    const wire = wireOf(type);
    if (wire === undefined) return Result.fail(new ThreadEntryUndecodable({ type, id, issue: 'no installed kind reads it' }));
    const result = wire.read(value);
    return Result.isSuccess(result)
      ? Result.succeed(result.success)
      : Result.fail(new ThreadEntryUndecodable({ type, id, issue: result.failure.message }));
  };
  const writeWire = (entry: ThreadTranscriptEntry): Result.Result<unknown, ThreadEntryUndecodable> => {
    const wire = wireOf(entry.type);
    if (wire === undefined)
      return Result.fail(new ThreadEntryUndecodable({ type: entry.type, id: entry.id, issue: 'no installed kind writes it' }));
    const result = wire.write(entry);
    return Result.isSuccess(result)
      ? Result.succeed(result.success)
      : Result.fail(new ThreadEntryUndecodable({ type: entry.type, id: entry.id, issue: result.failure.message }));
  };
  return {
    steps,
    base,
    worker,
    last,
    after,
    lags,
    below,
    formed,
    formedEvent,
    form,
    formEvent,
    decode,
    read,
    stored,
    storedForm,
    degraded,
    witnessing,
    readWire,
    writeWire,
  } as const;
};

export class ThreadEntryKinds extends Context.Service<ThreadEntryKinds, ThreadEntryReader>()('@runlith/agent/ThreadEntryKinds') {
  static readonly layer = (products: readonly ThreadEntryKind[]): Layer.Layer<ThreadEntryKinds> =>
    Layer.succeed(ThreadEntryKinds, makeThreadEntryReader({ products }));
}
