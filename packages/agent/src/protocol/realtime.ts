import { Cause, Effect, Schema, SchemaGetter } from 'effect';
import { AgentApprovalMode } from '../agent/contracts';
import { THREAD_COMPACTION_POINTS, threadInputAcceptanceSchema } from '../thread/storage/inbox';
import { ThreadRunConflictError } from '../thread/storage/runs';
import type { ThreadSaid } from '../thread/run/scheduler/inputs';
import { threadCauseOf } from '../thread/ThreadBorder';
import { threadQueuedTurnSchema } from './http';
import { WIRE_PAGE_MAX_BYTES } from '../transcript/cap';
import { OPEN_TEXT_MAX } from '../transcript/openText';

const trimmed = (checked: Schema.Codec<string, string>) =>
  Schema.String.pipe(
    Schema.decodeTo(checked, { decode: SchemaGetter.transform((value) => value.trim()), encode: SchemaGetter.passthrough() }),
  );

const threadAttachmentSchema = Schema.Struct({
  id: trimmed(Schema.String.check(Schema.isBetweenLength(1, 64))),
});

const inputKeySchema = trimmed(Schema.String.check(Schema.isBetweenLength(1, 128)));

export const threadSendSchema = Schema.Struct({
  text: Schema.optional(trimmed(Schema.String)),
  attachments: Schema.optional(Schema.Array(threadAttachmentSchema)),
  key: inputKeySchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      value.text || (value.attachments?.length ?? 0) > 0 ? undefined : 'Message must include text or at least one attachment.',
    ),
  ),
);

export const threadSteerSchema = Schema.Struct({
  expectedRunId: trimmed(Schema.String.check(Schema.isBetweenLength(1, 512))),
  text: trimmed(Schema.String.check(Schema.isMinLength(1))),
  attachments: Schema.optional(Schema.Array(threadAttachmentSchema)),
  key: inputKeySchema,
});

export const threadStopSchema = Schema.Struct({
  runId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  withdraw: Schema.optional(Schema.Boolean),
});

export const threadUnqueueSchema = Schema.Struct({
  inputId: trimmed(Schema.String.check(Schema.isBetweenLength(1, 512))),
});

export const threadCompactSchema = Schema.Struct({
  keep: Schema.optional(trimmed(Schema.String.check(Schema.isMinLength(1)))),
  at: Schema.optional(Schema.Literals(THREAD_COMPACTION_POINTS)),
  summarizer: Schema.optional(
    Schema.Struct({
      provider: trimmed(Schema.String.check(Schema.isMinLength(1))),
      model: trimmed(Schema.String.check(Schema.isMinLength(1))),
      reasoning: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

export const threadCompactResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.tag('started'), runId: Schema.String }),
  Schema.Struct({ status: Schema.tag('already-running'), runId: Schema.String }),
  Schema.Struct({
    status: Schema.tag('requested'),
    requestId: Schema.String,
    at: Schema.Literals(THREAD_COMPACTION_POINTS),
    runId: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('status'));

export const threadEntrySchema = Schema.Struct({
  entryId: trimmed(Schema.String.check(Schema.isBetweenLength(1, 512))),
});

export const threadEntriesSchema = Schema.Struct({
  before: Schema.Int,
});

export const threadTextSchema = Schema.Struct({
  ...threadEntrySchema.fields,
  from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: OPEN_TEXT_MAX })).annotate({
    description: `UTF-16 code units; at most ${OPEN_TEXT_MAX}, which fits the ${WIRE_PAGE_MAX_BYTES}-byte page with its frame at six JSON bytes a unit`,
  }),
});

export const threadAuthoritySchema = Schema.Struct({
  mode: AgentApprovalMode,
});

export const threadModelSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoning: Schema.NullOr(Schema.String),
  account: Schema.optional(Schema.NullOr(Schema.String)),
  switches: Schema.Record(Schema.String, Schema.String),
});

export const threadSaidResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.tag('started'),
    runId: Schema.String,
    acted: Schema.Boolean,
    acceptance: Schema.optional(threadInputAcceptanceSchema),
  }),
  Schema.Struct({
    status: Schema.tag('steered'),
    runId: Schema.String,
    itemId: Schema.String,
    acted: Schema.Boolean,
    acceptance: Schema.optional(threadInputAcceptanceSchema),
  }),
  Schema.Struct({
    status: Schema.tag('queued'),
    runId: Schema.String,
    queued: threadQueuedTurnSchema,
    acted: Schema.Boolean,
    acceptance: Schema.optional(threadInputAcceptanceSchema),
  }),
]).pipe(Schema.toTaggedUnion('status'));

export type ThreadSaidOnTheWire = typeof threadSaidResultSchema.Type;

export function threadSaidOnTheWire(said: ThreadSaid): ThreadSaidOnTheWire {
  const acted = said.replayed !== true;
  switch (said.status) {
    case 'queued':
      return { status: 'queued', runId: said.runId, queued: said.queued, acted, acceptance: said.acceptance };
    case 'steered':
      return { status: 'steered', runId: said.runId, itemId: said.itemId, acted, acceptance: said.acceptance };
    case 'started':
      return { status: 'started', runId: said.runId, acted, acceptance: said.acceptance };
  }
}

export const threadStopResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.tag('stopped'), runId: Schema.String }),
  Schema.Struct({ status: Schema.tag('requested'), runId: Schema.String }),
  Schema.Struct({ status: Schema.tag('nothing-running') }),
  Schema.Struct({ status: Schema.tag('run-mismatch'), runId: Schema.String }),
]).pipe(Schema.toTaggedUnion('status'));

export const threadUnqueueResultSchema = Schema.Struct({ status: Schema.Literals(['unqueued', 'not-queued']) });

export const threadTurnResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.tag('started'), runId: Schema.String }),
  Schema.Struct({ status: Schema.tag('already-running'), runId: Schema.String }),
]).pipe(Schema.toTaggedUnion('status'));

const threadQuestionAnswersSchema = Schema.Array(
  Schema.Struct({
    questionId: Schema.String.check(Schema.isBetweenLength(1, 512)),
    values: Schema.Array(Schema.String).check(Schema.isMaxLength(16)),
    annotation: Schema.optional(
      Schema.Struct({
        notes: Schema.optional(Schema.String),
        preview: Schema.optional(Schema.String),
      }),
    ),
  }),
).check(Schema.isBetweenLength(1, 64));

export const threadQuestionAnswerSchema = Schema.Struct({
  questionId: trimmed(Schema.String.check(Schema.isBetweenLength(1, 512))),
  answers: threadQuestionAnswersSchema,
  key: Schema.optional(trimmed(Schema.String.check(Schema.isBetweenLength(1, 256)))),
});

export const THREAD_CHAT_COMMANDS = {
  send: threadSendSchema,
  queue: threadSendSchema,
  steer: threadSteerSchema,
  'answer-question': threadQuestionAnswerSchema,
  unqueue: threadUnqueueSchema,
  stop: threadStopSchema,
  compact: threadCompactSchema,
  entry: threadEntrySchema,
  entries: threadEntriesSchema,
  model: threadModelSchema,
  authority: threadAuthoritySchema,
} as const;

export type ThreadChatCommand = keyof typeof THREAD_CHAT_COMMANDS;

export type ThreadChatCommandParams = {
  [K in ThreadChatCommand]: (typeof THREAD_CHAT_COMMANDS)[K]['Type'];
};

export function startingRun<A, E, R>(
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A | { readonly status: 'already-running'; readonly runId: string }, E, R> {
  return Effect.catchCause(work, (cause) => {
    const failure = threadCauseOf(Cause.squash(cause));
    return failure instanceof ThreadRunConflictError
      ? Effect.succeed({ status: 'already-running' as const, runId: failure.runId })
      : Effect.failCause(cause);
  });
}
