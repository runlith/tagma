import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import type { ModelStreamInput } from '@runlith/agent/modelPort';
import { agentReaderInput } from '@runlith/agent/AgentSignal';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { Clock, Context, Effect, Layer, Stream } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { OperatorNotes } from '../../../threads/contract/service/notes.js';
import { autoTitle } from '../../../threads/contract/wire/settings.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { settledThread } from './settled.fixture.js';

const usage = new Usage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
const READY: readonly LLMEvent[] = [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', text: 'Ready.' },
  { type: 'text-end', id: 'text' },
  { type: 'step-finish', index: 0, reason: 'stop', usage },
  { type: 'finish', reason: 'stop', usage },
];

const setup = Effect.gen(function* () {
  const sent: ModelStreamInput[] = [];
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: (input) => ({
        ...standing.request(input),
        stream: (call) => {
          sent.push(call);
          return Stream.fromIterable(READY);
        },
      }),
    }),
  });
  const now = yield* Clock.currentTimeMillis;
  yield* world.runtime.tokens.add('subscription', {
    accessToken: 'bearer',
    refreshToken: 'refresh',
    expiresAt: now + 3_600_000,
    scope: 'user:inference',
    account: { uuid: 'notes-account', email: 'notes@example.com' },
    organization: { uuid: 'notes-org', name: 'Notes' },
  });
  const projectId = yield* world.stealthProject();
  yield* Context.get(world.runtime.graph, Settings).write({ key: autoTitle.id, value: false, scope: 'project', projectId });
  const chosen = yield* world.op(
    'set_model_defaults',
    { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null },
    `project=${projectId}`,
  );
  expect(chosen.status).toBe(200);
  return { world, projectId, sent };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/OperatorNotesWorld') {}

const texts = (message: Message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

const noteRuns = (messages: readonly Message[]) =>
  messages.flatMap((message, at) => {
    const state = message.metadata?.runtimeState as Record<string, { inputs: readonly string[] }> | undefined;
    return state?.['operator-notes'] === undefined ? [] : [{ at, inputs: state['operator-notes'].inputs, text: texts(message) }];
  });

layer(Layer.effect(World, setup), { excludeTestServices: true, timeout: 30_000 })('operator notes on native', (it) => {
  it.effect('each operator message gets the set that stood when it was sent, right after its words, and none when the set is empty', () =>
    Effect.gen(function* () {
      const { world, projectId, sent } = yield* World;
      const notes = Context.get(world.runtime.owners, OperatorNotes);
      const turns = turnsOf(world.runtime.owners);
      const { thread } = yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null });
      const reader = { projectId, threadId: thread.id };
      const send = Effect.fnUntraced(function* (words: string) {
        const opened = yield* turns.send(thread.id, projectId, words);
        yield* settledThread({ threadId: thread.id, projectId, runId: opened.runId }).pipe(Effect.provide(world.runtime.owners));
        return sent.at(-1)!.messages;
      });

      yield* notes.switch({ scope: 'thread', reader }, 'stance', false);
      yield* notes.write({ scope: 'thread', reader }, 'first', 'FIRST-SET');
      const first = yield* send('Fix the parser.');
      yield* notes.write({ scope: 'thread', reader }, 'first', 'SECOND-SET');
      const second = yield* send('Now the lexer.');
      yield* notes.write({ scope: 'thread', reader }, 'first', null);
      const third = yield* send('And the tests.');

      const words = (messages: readonly Message[]) =>
        messages.flatMap((message, at) => (agentReaderInput(message) === undefined ? [] : [{ at, id: agentReaderInput(message)! }]));
      const [one] = words(first);
      expect(noteRuns(first).map((note) => [note.at, note.inputs, note.text.includes('FIRST-SET')])).toEqual([
        [first.length - 1, [one!.id], true],
      ]);
      const [, two] = words(second);
      expect(noteRuns(second).map((note) => [note.at, note.inputs, note.text.includes('SECOND-SET')])).toEqual([
        [first.length - 1, [one!.id], false],
        [second.length - 1, [two!.id], true],
      ]);
      expect(two!.at).toBeGreaterThan(first.length - 1);
      expect(second.slice(0, first.length)).toEqual([...first]);
      expect(noteRuns(third)).toHaveLength(2);
    }),
  );
});
