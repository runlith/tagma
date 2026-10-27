import { Schema } from 'effect';
import { transportWebSchema } from '@runlith/agent/thread/record';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

const hostedDoor = {
  doors: { http: 'perform' },
  tool: undefined,
  callers: 'thread',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
  subjects: () => [],
  confirmLabel: 'Serve',
} as const;

const PROVEN =
  'The thread is the one this call proves from its signed grant; its agent loop runs outside Tagma, and Tagma serves it the prompt, the turn context and the tools of the native agent the thread recorded at birth as its host, as that agent would run the thread; a thread that hosts none refuses `not-hosted`.';

const HOSTED_REFUSALS = ['session-unproven', 'not-found', 'thread-gone', 'not-hosted'] as const;

export const hostedToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  mutates: Schema.Boolean,
});
export type HostedToolWire = typeof hostedToolSchema.Type;

export const hostedContentSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('image'), data: Schema.String, mimeType: Schema.String }),
]);
export type HostedContent = typeof hostedContentSchema.Type;

export const hostedMessageSchema = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(hostedContentSchema) }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.Array(
      Schema.Union([
        Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
        Schema.Struct({ type: Schema.Literal('call'), id: Schema.String, name: Schema.String, input: Schema.Unknown }),
      ]),
    ),
  }),
  Schema.Struct({ role: Schema.Literal('result'), id: Schema.String, content: Schema.Array(hostedContentSchema), failed: Schema.Boolean }),
]);
export type HostedMessage = typeof hostedMessageSchema.Type;

export const HOSTED_OPERATIONS = {
  read_hosted_agent: operation('read_hosted_agent', {
    approval: ASKS_NEVER,
    ...hostedDoor,
    meaning: 'Read the system prompt Tagma serves a thread whose agent loop runs outside Tagma.',
    grammar: `${PROVEN}\nThe prompt is the one the thread's next run holds: frozen at its first run, replaced only at a run boundary. \`web\` says whose web the thread's runs search and read with: \`vendor\` is the agent's own, \`none\` the tools of the list.`,
    input: Schema.Struct({}),
    answer: arms({ ok: { prompt: Schema.String, web: transportWebSchema } }),
    refusals: HOSTED_REFUSALS,
    effect: 'read',
    identity: 'none',
    confirmation: () => ({ summary: 'Read the hosted prompt?' }),
    presentation: { running: 'Reading the hosted prompt', done: 'Read the hosted prompt' },
  }),

  read_hosted_tools: operation('read_hosted_tools', {
    approval: ASKS_NEVER,
    ...hostedDoor,
    meaning: 'Read the tools Tagma serves the running turn of a thread whose agent loop runs outside Tagma.',
    grammar: `${PROVEN}\nThe tools are those the turn's current step offers, and \`names\` every tool its run holds, offered at this step or not; with no turn running both are empty.`,
    input: Schema.Struct({}),
    answer: arms({ ok: { tools: Schema.Array(hostedToolSchema), names: Schema.Array(Schema.String) } }),
    refusals: HOSTED_REFUSALS,
    effect: 'read',
    identity: 'none',
    confirmation: () => ({ summary: 'Read the hosted tools?' }),
    presentation: { running: 'Reading the hosted tools', done: 'Read the hosted tools' },
  }),

  read_hosted_history: operation('read_hosted_history', {
    approval: ASKS_NEVER,
    ...hostedDoor,
    meaning:
      'Read the conversation Tagma holds for a thread whose agent loop runs outside Tagma, so a new session of that loop continues it.',
    grammar: `${PROVEN}\nThe history is the one the thread's next turn continues, in the words, calls and results the hosted tools speak; reasoning stays with the model that produced it.`,
    input: Schema.Struct({}),
    answer: arms({ ok: { messages: Schema.Array(hostedMessageSchema) } }),
    refusals: HOSTED_REFUSALS,
    effect: 'read',
    identity: 'none',
    confirmation: () => ({ summary: 'Read the hosted history?' }),
    presentation: { running: 'Reading the hosted history', done: 'Read the hosted history' },
  }),

  open_hosted_turn: operation('open_hosted_turn', {
    approval: ASKS_NEVER,
    ...hostedDoor,
    meaning:
      'Open the running turn of a thread whose agent loop runs outside Tagma: record and answer the turn context and the step guidance Tagma owes it, and the prompt the run holds.',
    grammar: `${PROVEN}\nAnswers nulls when the thread runs no turn; \`context\` is null when nothing is owed. Context answered before stays owed, ahead of what is new, until a prompt answer carries \`_meta["tagma/opened"]: true\`, so opening again after a lost answer or a turn that never reached the agent answers it again. \`web\` says whose web the turn searches and reads with: \`vendor\` is the agent's own, \`none\` the tools of the list.`,
    input: Schema.Struct({}),
    answer: arms({
      opened: {
        context: Schema.NullOr(Schema.String),
        prompt: Schema.NullOr(Schema.String),
        web: transportWebSchema,
      },
    }),
    refusals: HOSTED_REFUSALS,
    effect: 'write',
    identity: { key: 'request' },
    confirmation: () => ({ summary: 'Open the hosted turn?' }),
    presentation: { running: 'Opening the hosted turn', done: 'Opened the hosted turn' },
  }),

  call_hosted_tool: operation('call_hosted_tool', {
    approval: ASKS_NEVER,
    ...hostedDoor,
    meaning: "Perform one tool call of a thread whose agent loop runs outside Tagma, judged and executed as the thread's own agent would.",
    grammar: `${PROVEN}\nCalling again with the same id answers from the record. A call that reaches a server not yet holding its run refuses \`run-not-held\`; send it again. \`offered\` says the list of tools moved; read it again. \`words\` names the words handed to the turn's agent that it has not read yet; give the agent the result only once each of them stands in its queue.`,
    input: Schema.Struct({
      toolCallId: Schema.String.check(Schema.isMinLength(1)),
      name: Schema.String.check(Schema.isMinLength(1)),
      input: Schema.Unknown,
    }),
    answer: arms({
      called: {
        content: Schema.Array(hostedContentSchema),
        failed: Schema.Boolean,
        offered: Schema.Boolean,
        words: Schema.Array(Schema.String),
      },
    }),
    refusals: [...HOSTED_REFUSALS, 'run-not-held'],
    effect: 'external',
    identity: { key: 'request' },
    deadline: 'wait-input',
    confirmation: (input) => ({ summary: `Perform ${input.name}?` }),
    presentation: { running: 'Performing a hosted call', done: 'Performed a hosted call' },
  }),
} as const;

export type HostedOperationId = keyof typeof HOSTED_OPERATIONS;
