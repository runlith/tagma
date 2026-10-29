import { McpAppCallResult } from '@runlith/mcp/apps';
import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ViewId } from './points.js';
import { STORAGE_REFUSALS, tagmaAppName, VIEW_REFUSALS } from './sets.js';

const viewed = {
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  approval: ASKS_NEVER,
} as const;

const mounted = { app: tagmaAppName, view: ViewId };

const storageKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
  description: 'The key, shared by every view of the app.',
});

export const VIEW_OPERATIONS = {
  call_app_tool: operation('call_app_tool', {
    ...viewed,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { result: McpAppCallResult } }),
    meaning: 'Call a tool of an app on behalf of its own view, as the operator acting in it.',
    grammar:
      'Only a tool the app offers to its views is called, and only while the app is enabled in this project; the caller the process receives names the view and its thread.',
    input: Schema.Struct({
      ...mounted,
      tool: Schema.String.check(Schema.isMinLength(1)),
      arguments: Schema.Record(Schema.String, Schema.Unknown),
      threadId: Schema.optional(Schema.String.annotate(placeRole('value'))),
    }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Call ${input.tool} of the app ${input.app} from its view?` }),
    confirmLabel: 'Call',
    presentation: { running: 'Calling an app tool', done: 'Called an app tool' },
    subjects: () => [],
  }),
  read_app_resource: operation('read_app_resource', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        contents: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
        _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      },
    }),
    meaning: 'Read one resource of an app’s process for its own view.',
    input: Schema.Struct({ ...mounted, uri: Schema.String.check(Schema.isMinLength(1)) }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Read ${input.uri} from the app ${input.app}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading an app resource', done: 'Read an app resource' },
    subjects: () => [],
  }),
  read_view_storage: operation('read_view_storage', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { stored: Schema.Boolean, value: Schema.optional(Schema.Unknown) } }),
    meaning: 'Read one value an app’s views keep under a key.',
    grammar: 'The values belong to the app on this machine, across projects; they stand in its data directory.',
    input: Schema.Struct({ ...mounted, key: storageKey }),
    refusals: STORAGE_REFUSALS,
    confirmation: (input) => ({ summary: `Read ${input.key} of the app ${input.app}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading view storage', done: 'Read view storage' },
    subjects: () => [],
  }),
  write_view_storage: operation('write_view_storage', {
    ...viewed,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: { stored: Schema.Boolean } }),
    meaning: 'Keep a JSON value under a key for an app’s views, or remove it when no value is given.',
    grammar: 'A value takes at most 1 MiB as JSON.',
    input: Schema.Struct({ ...mounted, key: storageKey, value: Schema.optional(Schema.Unknown) }),
    refusals: STORAGE_REFUSALS,
    confirmation: (input) => ({ summary: `Keep ${input.key} for the app ${input.app}?` }),
    confirmLabel: 'Keep',
    presentation: { running: 'Writing view storage', done: 'Wrote view storage' },
    subjects: () => [],
  }),
};

export type ViewOperationId = keyof typeof VIEW_OPERATIONS;
