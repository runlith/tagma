import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, feed, operation } from '../../../platform/contract/wire/operation.js';

const keySchema = Schema.NonEmptyString.annotate({ description: 'The name the app keeps the document under.' });

export const appDocumentSchema = Schema.Struct({
  key: keySchema,
  value: Schema.String,
  revision: Schema.Int,
});
export type AppDocument = typeof appDocumentSchema.Type;

export const appStateEventSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('current'), revision: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal('changed'),
    key: keySchema,
    value: Schema.NullOr(Schema.String),
    revision: Schema.Int,
    writer: Schema.String,
  }),
]);
export type AppStateEvent = typeof appStateEventSchema.Type;

const operatorOnly = {
  approval: ASKS_NEVER,
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
  refusals: [],
  subjects: () => [],
} as const;

export const APP_STATE_OPERATIONS = {
  read_app_state: operation('read_app_state', {
    ...operatorOnly,
    effect: 'read',
    identity: 'none',
    meaning: 'Read every document the app keeps for its operator on this server, with the revision each was last written at.',
    grammar:
      '`revision` is the newest revision the server has written, a removal included: a document absent from the answer was removed at or before it, or never written.',
    input: Schema.Struct({}),
    answer: arms({ read: { documents: Schema.Array(appDocumentSchema), revision: Schema.Int } }),
    confirmation: () => ({ summary: 'Read the documents the app keeps?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the app documents', done: 'Read the app documents' },
  }),
  write_app_state: operation('write_app_state', {
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'Set or remove one document the app keeps for its operator, and tell every window of the change.',
    grammar:
      'The server keeps `value` as given and never reads into it; null removes the document. `writer` names the window that writes, so it can tell its own change in the feed. Answers the revision the write took, higher than every revision before it.',
    input: Schema.Struct({ key: keySchema, value: Schema.NullOr(Schema.String), writer: Schema.NonEmptyString }),
    answer: arms({ written: { revision: Schema.Int } }),
    confirmation: (input) => ({ summary: `${input.value === null ? 'Remove' : 'Write'} the app document ${input.key}?` }),
    confirmLabel: 'Write',
    presentation: { running: 'Writing an app document', done: 'Wrote an app document' },
  }),
};

export type AppStateOperationId = keyof typeof APP_STATE_OPERATIONS;

export const APP_STATE_FEED = feed('app-state.changes', {
  input: Schema.Struct({}),
  event: appStateEventSchema,
  refusals: [],
  callers: 'operator',
  graph: 'none',
});
