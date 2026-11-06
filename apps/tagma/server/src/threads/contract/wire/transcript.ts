import { ThreadQuestionPrompt } from '@runlith/agent/transcript/entries';
import { Schema } from 'effect';

const threadId = Schema.String.check(Schema.isMinLength(1));

export const TranscriptToolState = Schema.Literals(['running', 'done', 'refused', 'failed']);

const transcriptEntrySchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.NullOr(Schema.String),
  role: Schema.Literals(['user', 'assistant', 'tool', 'question', 'notice']),
  sender: Schema.optional(Schema.Struct({ name: Schema.String, threadId: Schema.optional(Schema.String) })),
  text: Schema.optional(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      state: TranscriptToolState,
      input: Schema.Unknown,
      output: Schema.optional(Schema.Unknown),
    }),
  ),
  question: Schema.optional(Schema.Struct({ id: Schema.String, prompts: Schema.Array(ThreadQuestionPrompt), answered: Schema.Boolean })),
});
export type TranscriptEntry = typeof transcriptEntrySchema.Type;

const transcriptPageSchema = Schema.Struct({
  threadId,
  entries: Schema.Array(transcriptEntrySchema),
  more: Schema.Boolean,
});
export type TranscriptPage = typeof transcriptPageSchema.Type;

const transcriptTailSchema = Schema.Union([
  Schema.Struct({ restart: Schema.Literal(true), entries: Schema.Array(transcriptEntrySchema) }),
  Schema.Struct({ restart: Schema.Literal(false), id: Schema.String, text: Schema.String }),
]);
export type TranscriptTail = typeof transcriptTailSchema.Type;

const transcriptEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.tag('initial'),
    ...transcriptPageSchema.fields,
    tail: Schema.Array(transcriptEntrySchema),
  }),
  Schema.Struct({ type: Schema.tag('entry'), threadId, entry: transcriptEntrySchema }),
  Schema.Struct({ type: Schema.tag('removed'), threadId, ids: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.tag('tail'), threadId, tail: transcriptTailSchema }),
  Schema.Struct({ type: Schema.tag('failed'), threadId, reason: Schema.String }),
]).pipe(Schema.toTaggedUnion('type'));
export type TranscriptEvent = typeof transcriptEventSchema.Type;
