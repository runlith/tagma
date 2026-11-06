import { McpAppCallResult } from '@runlith/mcp/apps';
import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placeRole, projectField } from '../../../platform/contract/wire/place.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ACTION_REFUSALS } from './actions.js';
import { ViewId } from './points.js';
import { pluginName, STORAGE_REFUSALS, VIEW_REFUSALS } from './sets.js';

const viewed = {
  doors: { http: true },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  approval: ASKS_NEVER,
} as const;

const mounted = { plugin: pluginName, view: ViewId };

const storageKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
  description: 'The key, shared by every view of the plugin.',
});

export const VIEW_OPERATIONS = {
  call_plugin_tool: operation('call_plugin_tool', {
    ...viewed,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { result: McpAppCallResult } }),
    meaning: 'Call a tool of a plugin on behalf of its own view, as the operator acting in it.',
    grammar:
      'Only a tool the plugin offers to its views is called, and only while the plugin is enabled in this project; the caller the process receives names the view and its thread.',
    input: Schema.Struct({
      ...mounted,
      tool: Schema.String.check(Schema.isMinLength(1)),
      arguments: Schema.Record(Schema.String, Schema.Unknown),
      threadId: Schema.optional(Schema.String.annotate(placeRole('value'))),
    }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Call ${input.tool} of the plugin ${input.plugin} from its view?` }),
    confirmLabel: 'Call',
    presentation: { running: 'Calling a plugin tool', done: 'Called a plugin tool' },
    subjects: () => [],
  }),
  run_plugin_action: operation('run_plugin_action', {
    ...viewed,
    place: 'project',
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { said: Schema.NullOr(Schema.String) } }),
    meaning:
      'Run an action of a plugin for the operator, from the palette, a shortcut or a command in a thread’s composer, in this project.',
    grammar:
      'Only an action the plugin declares in contributes.actions runs, and only while the plugin is enabled in this project; the process receives the caller operator in this project and starts if it sleeps. From a composer, `threadId` names its thread, which the process receives in its caller as a view’s tool call does, and `args` the words typed after the command, which the handler receives as its input, empty otherwise. `said` is the text the handler answers — a notice from the palette, the draft from a composer — or null; a handler that fails refuses plugin-call-failed with its reason.',
    input: Schema.Struct({
      project: projectField,
      plugin: pluginName,
      action: ViewId,
      threadId: Schema.optional(Schema.String.annotate(placeRole('value'))),
      args: Schema.optional(Schema.String.annotate({ description: 'The words typed after the command in the composer.' })),
    }),
    refusals: ACTION_REFUSALS,
    confirmation: (input) => ({ summary: `Run ${input.action} of the plugin ${input.plugin}?` }),
    confirmLabel: 'Run',
    presentation: { running: 'Running a plugin action', done: 'Ran a plugin action' },
    subjects: () => [],
  }),
  read_plugin_resource: operation('read_plugin_resource', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        contents: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
        _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      },
    }),
    meaning: 'Read one resource of a plugin’s process for its own view.',
    input: Schema.Struct({ ...mounted, uri: Schema.String.check(Schema.isMinLength(1)) }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Read ${input.uri} from the plugin ${input.plugin}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading a plugin resource', done: 'Read a plugin resource' },
    subjects: () => [],
  }),
  read_view_storage: operation('read_view_storage', {
    ...viewed,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { stored: Schema.Boolean, value: Schema.optional(Schema.Unknown) } }),
    meaning: 'Read one value a plugin’s views keep under a key.',
    grammar: 'The values belong to the plugin on this machine, across projects; they stand in its data directory.',
    input: Schema.Struct({ ...mounted, key: storageKey }),
    refusals: STORAGE_REFUSALS,
    confirmation: (input) => ({ summary: `Read ${input.key} of the plugin ${input.plugin}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading view storage', done: 'Read view storage' },
    subjects: () => [],
  }),
  write_view_storage: operation('write_view_storage', {
    ...viewed,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: { stored: Schema.Boolean } }),
    meaning: 'Keep a JSON value under a key for a plugin’s views, or remove it when no value is given.',
    grammar: 'A value takes at most 1 MiB as JSON.',
    input: Schema.Struct({ ...mounted, key: storageKey, value: Schema.optional(Schema.Unknown) }),
    refusals: STORAGE_REFUSALS,
    confirmation: (input) => ({ summary: `Keep ${input.key} for the plugin ${input.plugin}?` }),
    confirmLabel: 'Keep',
    presentation: { running: 'Writing view storage', done: 'Wrote view storage' },
    subjects: () => [],
  }),
};

export type ViewOperationId = keyof typeof VIEW_OPERATIONS;
