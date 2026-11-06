import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Context, Data, Effect, Layer, Schedule, Schema, Stream } from 'effect';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { installedFixture } from '../plugin-host/installed.js';
import { PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';

const TUTOR = { 'x-tagma-caller': 'plugin:tutor' } as const;
const PROMPT = 'Which word means house?';
const decodeSnapshot = Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema);

class NeverHeld extends Data.TaggedError('NeverHeld')<{ readonly what: string }> {}

const toolCall = (id: string, name: string, input: unknown): Stream.Stream<LLMEvent> =>
  Stream.fromIterable<LLMEvent>([
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls' },
  ]);

const said = (text: string): Stream.Stream<LLMEvent> =>
  Stream.fromIterable<LLMEvent>([
    { type: 'text-start', id: 'reply' },
    { type: 'text-delta', id: 'reply', text },
    { type: 'text-end', id: 'reply' },
    { type: 'finish', reason: 'stop' },
  ]);

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (input) => ({
      ...standing.request(input),
      web: undefined,
      stream: (call) => {
        const results = new Set(
          call.messages.flatMap((message) => message.content).flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])),
        );
        if (!results.has('reveal')) return toolCall('reveal', 'tool_search', { query: 'select:ask_user' });
        if (!results.has('quiz'))
          return toolCall('quiz', 'ask_user', {
            questions: [
              {
                prompt: PROMPT,
                options: [
                  { value: 'Haus', label: 'Haus' },
                  { value: 'Maus', label: 'Maus' },
                ],
              },
            ],
          });
        return said('Right.');
      },
    }),
  }),
});

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const projectId = yield* world.plainProject();
  yield* installedFixture(world, projectId, { id: 'tutor', title: 'German tutor', contributes: { on: { asked: 'asked' } } });
  const data = join(world.dataHome, 'agent-plugin-data', 'tutor');
  return { world, account, projectId, data };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/PluginQuestionsWorld') {}

type Row = { readonly threadId: string; readonly kind: string };
type Asked = {
  readonly threadId: string;
  readonly questionId: string;
  readonly prompts: readonly { readonly id: string; readonly prompt: string }[];
};

const op = (id: string, input: unknown, headers?: Readonly<Record<string, string>>) =>
  Effect.flatMap(World, ({ world, projectId }) => world.op(id, input, `project=${projectId}`, headers));

const until = <A, E, R>(what: string, read: Effect.Effect<A | null, E, R>) =>
  Effect.retry(
    Effect.flatMap(read, (value) => (value === null ? Effect.fail(new NeverHeld({ what })) : Effect.succeed(value))),
    { schedule: Schedule.spaced('20 millis') },
  ).pipe(Effect.timeoutOrElse({ duration: '20 seconds', orElse: () => Effect.die(new Error(`never held: ${what}`)) }));

const askedOf = (threadId: string) =>
  until(
    `the tutor was asked on ${threadId}`,
    Effect.flatMap(World, ({ data }) =>
      Effect.promise(async () => {
        const file = join(data, 'journal');
        const lines = existsSync(file) ? (await readFile(file, 'utf8')).trim().split('\n') : [];
        const line = lines.find((one) => one.startsWith('asked tagma ') && one.includes(threadId));
        return line === undefined ? null : (JSON.parse(line.slice('asked tagma '.length)) as Asked);
      }),
    ),
  );

const inAttention = (threadId: string) =>
  Effect.flatMap(World, ({ world }) =>
    Effect.map(world.op('read_attention', { limit: 20 }, ''), (answer) =>
      (answer.body as { readonly rows: readonly Row[] }).rows.some((row) => row.threadId === threadId),
    ),
  );

const quizzed = Effect.fnUntraced(function* (title: string) {
  const { account } = yield* World;
  const created = yield* op('create_thread', { title, account }, TUTOR);
  expect(created.status).toBe(200);
  const threadId = (yield* decodeSnapshot(created.body)).snapshot.thread.id;
  expect((yield* op('start_turn', { threadId, text: 'Quiz me.', key: `quiz-${threadId}` }, TUTOR)).body).toMatchObject({
    status: 'started',
  });
  return threadId;
});

const marked = (name: string, on: boolean) =>
  Effect.flatMap(World, ({ data }) => Effect.promise(() => (on ? writeFile(join(data, name), '') : rm(join(data, name), { force: true }))));

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('questions of a plugin’s threads', (it) => {
  it.effect('a tutor’s ask_user wakes the idle plugin, stays out of Attention, and the plugin’s answer_question lets the run go on', () =>
    Effect.gen(function* () {
      const { world } = yield* World;
      const host = Context.get(world.runtime.owners, PluginHost);
      yield* until(
        'the tutor stands idle',
        Effect.sync(() => (host.reading('tutor')?.state === 'idle' ? true : null)),
      );
      const threadId = yield* quizzed('tutor');
      const asked = yield* askedOf(threadId);
      expect(asked.prompts).toMatchObject([{ prompt: PROMPT }]);
      expect(yield* inAttention(threadId)).toBe(false);
      const answer = { threadId, questionId: asked.questionId, answers: [{ questionId: asked.prompts[0]!.id, values: ['Haus'] }] };
      expect((yield* op('answer_question', answer, TUTOR)).body).toMatchObject({ status: 'started' });
      yield* until(
        'the tutor run completed after the answer',
        Effect.map(op('read_statuses', { threads: [threadId], limit: 1 }, TUTOR), (read) => {
          const [row] = (
            read.body as {
              readonly rows: readonly { readonly status: { readonly life: string; readonly ending?: { readonly status: string } } }[];
            }
          ).rows;
          return row?.status.life === 'idle' && row.status.ending?.status === 'completed' ? true : null;
        }),
      );
    }),
  );

  it.effect('a question the plugin leaves, or whose delivery fails, stands with the person in Attention', () =>
    Effect.gen(function* () {
      for (const mark of ['leave', 'fail-asked']) {
        yield* marked(mark, true);
        const threadId = yield* quizzed(mark);
        yield* askedOf(threadId);
        yield* until(
          `the ${mark} question stands in Attention`,
          Effect.map(inAttention(threadId), (shown) => (shown ? true : null)),
        );
        yield* marked(mark, false);
      }
    }),
  );

  it.effect('switching the plugin off in the project hands its open question to the person', () =>
    Effect.gen(function* () {
      const threadId = yield* quizzed('switched off');
      yield* askedOf(threadId);
      expect(yield* inAttention(threadId)).toBe(false);
      expect((yield* op('enable_plugin', { id: 'tutor', enabled: false, scope: 'project' })).status).toBe(200);
      yield* Effect.addFinalizer(() => op('enable_plugin', { id: 'tutor', enabled: true, scope: 'project' }).pipe(Effect.orDie));
      yield* until(
        'the switched-off question stands in Attention',
        Effect.map(inAttention(threadId), (shown) => (shown ? true : null)),
      );
    }),
  );
});
