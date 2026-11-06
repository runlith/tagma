import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, feed, operation } from '../../../platform/contract/wire/operation.js';

export const TITLE_CHARS = 120;
export const BODY_CHARS = 480;
export const QUESTION_CHARS = 240;
export const OPTIONS = 4;
export const OPTION_CHARS = 80;
export const ANSWER_CHARS = 1000;
export const OPEN_PER_SENDER = 20;
export const KEY_CHARS = 200;

export const OUTCOME_KINDS = ['answered', 'dismissed'] as const;

export const questionSchema = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(QUESTION_CHARS)).annotate({
    description: `What the operator is asked, at most ${QUESTION_CHARS} characters.`,
  }),
  options: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(OPTION_CHARS)))
    .check(Schema.isMaxLength(OPTIONS), Schema.isUnique())
    .annotate({
      description: `The answers the operator picks from, at most ${OPTIONS} different ones of at most ${OPTION_CHARS} characters. Empty means a free-text answer.`,
    }),
});
export type Question = typeof questionSchema.Type;

export const outcomeSchema = Schema.Struct({
  kind: Schema.Literals(OUTCOME_KINDS),
  answer: Schema.NullOr(Schema.String),
  at: Schema.String,
});
export type Outcome = typeof outcomeSchema.Type;

export const notificationLinkSchema = Schema.Struct({ kind: Schema.String, target: Schema.Json });
export type NotificationLink = typeof notificationLinkSchema.Type;

export const notificationSchema = Schema.Struct({
  id: Schema.String,
  sender: Schema.String,
  title: Schema.String,
  body: Schema.String,
  at: Schema.String,
  question: Schema.NullOr(questionSchema),
  link: Schema.NullOr(notificationLinkSchema),
});
export type Notification = typeof notificationSchema.Type;

export const notificationsFeedEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.tag('list'), rows: Schema.Array(notificationSchema) }),
  Schema.Struct({ type: Schema.tag('put'), row: notificationSchema }),
  Schema.Struct({ type: Schema.tag('gone'), id: Schema.String }),
]).pipe(Schema.toTaggedUnion('type'));
export type NotificationsFeedEvent = typeof notificationsFeedEventSchema.Type;

export const NOTIFICATIONS_FEED = feed('notifications.subscribe', {
  input: Schema.Struct({}),
  event: notificationsFeedEventSchema,
  refusals: [],
  callers: 'operator',
});

export const NOTIFY_FEEDS = [NOTIFICATIONS_FEED] as const;

const IdInput = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The id send_notification answered.' }),
});

const handled = {
  approval: ASKS_NEVER,
  doors: { http: 'perform' },
  callers: 'operator',
  tool: undefined,
  external: true,
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
  subjects: () => [],
  effect: 'write',
  identity: { key: 'call' },
} as const;

const resolved = {
  resolved: { id: Schema.String, outcome: outcomeSchema, repeated: Schema.Boolean },
} as const;

export const NOTIFY_OPERATIONS = {
  send_notification: operation('send_notification', {
    ...handled,
    meaning:
      "Put a notification in front of the operator: in the Attention list of the app and as a push on their paired devices. With a question it waits for the operator's answer, which comes back to the sender as a durable outcome.",
    grammar:
      'Called by a running plugin process as `$TAGMA_CALLER` (plugin:<id>), which becomes the sender; contributes.notify names the tool that receives its outcomes, and the answer carries the notification id. With `question.options` the operator picks one of them, without options they type a free text. A notification without a question is dismissed by the operator. A `key` makes the send repeatable: the same key from the same sender returns the id of the notification it first made, with `repeated: true`, whatever the repeat says and whether that notification is still open or already settled; the same key from another sender is a separate notification. A key is remembered as long as its notification is — until a week after it settled. Each sender holds at most 20 open notifications. The outcome — `answered` with the answer or `dismissed` — is handed to the sender until it takes it; it is the same record whenever it is answered again.',
    input: Schema.Struct({
      title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(TITLE_CHARS)).annotate({
        description: `What this is about, at most ${TITLE_CHARS} characters.`,
      }),
      body: Schema.optional(Schema.String.check(Schema.isMaxLength(BODY_CHARS))).annotate({
        description: `More words under the title, at most ${BODY_CHARS} characters.`,
      }),
      question: Schema.optional(questionSchema),
      key: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(KEY_CHARS))).annotate({
        description: `The sender's own name for this notification, at most ${KEY_CHARS} characters. Sending the same key again returns the notification it first made instead of making another.`,
      }),
    }),
    answer: arms({ sent: { id: Schema.String, repeated: Schema.Boolean } }),
    refusals: ['sender-required', 'too-many-open'],
    confirmation: () => ({ summary: 'Notify the operator?' }),
    confirmLabel: 'Notify',
    presentation: { running: 'Notifying the operator', done: 'Notified the operator' },
  }),
  answer_notification: operation('answer_notification', {
    ...handled,
    external: undefined,
    callers: 'operator',
    meaning: "Answer a notification's question; the first answer or dismissal settles the outcome, and a later one returns it unchanged.",
    grammar:
      '`value` is one of the question options, or a free text when the question has none. `repeated` is true when the notification was already settled, and `outcome` is then the one that settled it.',
    input: Schema.Struct({
      ...IdInput.fields,
      value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(ANSWER_CHARS)).annotate({
        description: 'The picked option, or the free text.',
      }),
    }),
    answer: arms(resolved),
    refusals: ['not-found', 'no-question', 'bad-answer'],
    confirmation: () => ({ summary: 'Send this answer?' }),
    confirmLabel: 'Answer',
    presentation: { running: 'Sending the answer', done: 'Sent the answer' },
  }),
  dismiss_notification: operation('dismiss_notification', {
    ...handled,
    external: undefined,
    callers: 'operator',
    meaning: 'Take a notification off the Attention list without an answer; the sender is told it was dismissed.',
    grammar: '`repeated` is true when the notification was already settled, and `outcome` is then the one that settled it.',
    input: IdInput,
    answer: arms(resolved),
    refusals: ['not-found'],
    confirmation: () => ({ summary: 'Dismiss this notification?' }),
    confirmLabel: 'Dismiss',
    presentation: { running: 'Dismissing the notification', done: 'Dismissed the notification' },
  }),
};

export type NotifyOperationId = keyof typeof NOTIFY_OPERATIONS;
