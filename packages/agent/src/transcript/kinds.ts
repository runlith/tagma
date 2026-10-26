import { Context, Data, Layer, Result, Schema } from 'effect';
import { THREAD_CORE_ENTRIES, type ThreadEntry } from './entries';
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

  constructor(
    entry: ThreadProductEntry,
    readonly refusal: ThreadEntryUndecodable,
  ) {
    this.id = entry.id;
    this.runId = entry.runId;
    this.occurredAt = entry.occurredAt;
    this.rewound = entry.rewound;
  }

  static is(entry: ThreadTranscriptEntry): entry is ThreadEntryUnreadable {
    return entry.type === 'entry-unreadable' && 'refusal' in entry && entry.refusal instanceof ThreadEntryUndecodable;
  }
}

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

export type ThreadFormStep = {
  readonly name: string;
  readonly samples: Readonly<Partial<Record<ThreadFormRecord, Held>>>;
} & {
  readonly [record in ThreadFormRecord]?: (held: Held) => Held | null;
};

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

export type ThreadReaderInput = {
  readonly products: readonly ThreadEntryKind[];
  readonly steps?: readonly ThreadFormStep[];
  readonly base?: ThreadFormBase | null;
};

export type ThreadEntryReader = ReturnType<typeof makeThreadEntryReader>;

export const makeThreadEntryReader = ({ products, steps = [], base = null }: ThreadReaderInput) => {
  const readers = new Map<string, Reader>();
  const schemas = new Map<string, ThreadEntryKind['schema']>();
  for (const kind of [...CORE_KINDS, ...products]) {
    if (readers.has(kind.type)) throw new Error(`Transcript entry kind ${kind.type} is declared twice.`);
    const decode = Schema.decodeUnknownResult(kind.schema);
    readers.set(kind.type, (value) => decode(value, { onExcessProperty: 'error' }));
    schemas.set(kind.type, kind.schema);
  }
  const wires = new Map<string, Wire>();
  const wireOf = (type: string | null): Wire | undefined => {
    if (type === null) return undefined;
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
  };
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
    const { type, id } = identified(formed);
    const reader = type === null ? undefined : readers.get(type);
    if (reader === undefined) return Result.fail(new ThreadEntryUndecodable({ type, id, issue: 'no installed kind reads it' }));
    const result = reader(formed);
    return Result.isSuccess(result)
      ? Result.succeed(result.success)
      : Result.fail(new ThreadEntryUndecodable({ type, id, issue: result.failure.message }));
  };
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
  return { steps, base, last, after, lags, below, formed, formedEvent, form, formEvent, decode, read, readWire, writeWire } as const;
};

export class ThreadEntryKinds extends Context.Service<ThreadEntryKinds, ThreadEntryReader>()('@runlith/agent/ThreadEntryKinds') {
  static readonly layer = (products: readonly ThreadEntryKind[]): Layer.Layer<ThreadEntryKinds> =>
    Layer.succeed(ThreadEntryKinds, makeThreadEntryReader({ products }));
}
