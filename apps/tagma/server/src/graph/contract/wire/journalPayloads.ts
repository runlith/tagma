import { Data, Result, Schema } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { STORAGE_MODES } from '../../../projects/contract/wire/project.js';

export const bodySpanSchema = Schema.Struct({ at: Schema.Number, del: Schema.String, ins: Schema.String });
export type BodySpan = typeof bodySpanSchema.Type;
export type BodyDelta = readonly BodySpan[];

const move = {
  tag: Schema.optional(Schema.String),
  field: Schema.optional(Schema.String),
  from: Schema.optional(Schema.NullOr(Schema.String)),
  to: Schema.optional(Schema.String),
};

const ending = {
  ...move,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  commit: Schema.optional(Schema.NullOr(Schema.String)),
  amends: Schema.optional(Schema.Number),
  ops: Schema.optional(Schema.Number),
};

const list = Schema.optional(Schema.Array(Schema.Unknown));

const SHAPES = {
  update: Schema.Struct({
    status: Schema.optional(Schema.String),
    wasStatus: Schema.optional(Schema.NullOr(Schema.String)),
    tags: Schema.optional(Schema.Array(Schema.String)),
    wasTags: Schema.optional(Schema.Array(Schema.String)),
    title: Schema.optional(Schema.String),
    wasTitle: Schema.optional(Schema.String),
    structural: Schema.optional(Schema.Boolean),
    wasFields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    chars: Schema.optional(Schema.Number),
    wasChars: Schema.optional(Schema.Number),
    delta: Schema.optional(Schema.Array(bodySpanSchema)),
    storage: Schema.optional(Schema.Literals(STORAGE_MODES)),
    blocks: Schema.optional(Schema.Number),
  }),
  ending: Schema.Struct(ending),
  verdict: Schema.Struct({ ...ending, by: Schema.optional(Schema.Array(Schema.Number)) }),
  link: Schema.Struct({ kind: Schema.optional(Schema.String), toId: Schema.optional(Schema.Number), far: Schema.optional(Schema.String) }),
  anchor: Schema.Struct({ path: Schema.optional(Schema.String), kind: Schema.optional(Schema.String) }),
  unanchor: Schema.Struct({ path: Schema.optional(Schema.String), symbol: Schema.optional(Schema.NullOr(Schema.String)) }),
  relocate: Schema.Struct({ from: Schema.optional(Schema.String), to: Schema.optional(Schema.String) }),
  supersede: Schema.Struct({ withId: Schema.Number }),
  settle: Schema.Struct({
    settled: Schema.Array(Schema.Number),
    wasTag: Schema.optional(Schema.String),
    tag: Schema.optional(Schema.String),
  }),
  trash: Schema.Struct({ ids: Schema.Array(Schema.Number) }),
  enforce: Schema.Struct({ strictness: Schema.optional(Schema.String), imported: Schema.optional(Schema.Boolean) }),
  remeasure: Schema.Struct({ retired: list, escaped: list, fixed: list }),
  revise: Schema.Struct({ amends: Schema.optional(Schema.Number), ops: Schema.optional(Schema.Number) }),
  answer: Schema.Struct({
    by: Schema.optional(Schema.Number),
    commit: Schema.optional(Schema.String),
    checked: Schema.optional(Schema.Union([Schema.String, Schema.Literal(true)])),
    head: Schema.optional(Schema.NullOr(Schema.String)),
  }),
};

export type EndingPayload = typeof SHAPES.ending.Type;
export type VerdictPayload = typeof SHAPES.verdict.Type;

export class JournalPayloadUnreadable extends Data.TaggedError('JournalPayloadUnreadable')<{
  readonly eventId: number;
  readonly op: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `journal event ${this.eventId} (${this.op}) carries a payload this server cannot read: ${this.reason}`;
  }
}

type StoredEntry = { readonly id: number; readonly op: string; readonly payload: string };

const reader = <S extends Schema.Decoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownResult(Schema.fromJsonString(schema));
  return (entry: StoredEntry): Result.Result<S['Type'], JournalPayloadUnreadable> =>
    Result.mapError(
      decode(entry.payload),
      (failure) => new JournalPayloadUnreadable({ eventId: entry.id, op: entry.op, reason: String(failure) }),
    );
};

export const readJournal = {
  update: reader(SHAPES.update),
  ending: reader(SHAPES.ending),
  verdict: reader(SHAPES.verdict),
  link: reader(SHAPES.link),
  anchor: reader(SHAPES.anchor),
  unanchor: reader(SHAPES.unanchor),
  relocate: reader(SHAPES.relocate),
  supersede: reader(SHAPES.supersede),
  settle: reader(SHAPES.settle),
  trash: reader(SHAPES.trash),
  enforce: reader(SHAPES.enforce),
  remeasure: reader(SHAPES.remeasure),
  revise: reader(SHAPES.revise),
  answer: reader(SHAPES.answer),
};

export const journalUnreadable = (error: JournalPayloadUnreadable): GateRefusal<'journal-unreadable'> =>
  new GateRefusal('journal-unreadable', error.message, [
    'the journal row is stored damaged; read the block through its current state instead of its history',
  ]);
