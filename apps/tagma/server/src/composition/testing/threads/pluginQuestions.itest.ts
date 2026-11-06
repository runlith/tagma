import { expect } from 'bun:test';
import { existsSync, watch } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Context, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { installedFixture } from '../plugin-host/installed.js';
import { PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { listOf } from '../../../threads/testing/doubles.js';

const TUTOR = { 'x-tagma-caller': 'plugin:tutor' } as const;
const COACH = { 'x-tagma-caller': 'plugin:coach' } as const;
const PROMPT = 'Which word means house?';
const decodeSnapshot = Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema);

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
  const data = (plugin: string) => join(world.dataHome, 'agent-plugin-data', plugin);
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

const journaled = <A>(plugin: string, found: (lines: readonly string[]) => A | null) =>
  Effect.flatMap(World, ({ data }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = data(plugin);
        const file = join(directory, 'journal');
        yield* Effect.promise(() => mkdir(directory, { recursive: true }));
        const moved = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => watch(directory, () => Queue.offerUnsafe(moved, undefined))),
          (watcher) => Effect.sync(() => watcher.close()),
        );
        for (;;) {
          const lines = yield* Effect.promise(async () => (existsSync(file) ? (await readFile(file, 'utf8')).trim().split('\n') : []));
          const value = found(lines);
          if (value !== null) return value;
          yield* Queue.take(moved);
        }
      }),
    ),
  );

const askedOf = (threadId: string, plugin = 'tutor', times = 1) =>
  journaled(plugin, (lines) => {
    const asked = lines
      .filter((one) => one.startsWith('asked tagma ') && one.includes(threadId))
      .map((line) => JSON.parse(line.slice('asked tagma '.length)) as Asked);
    return asked.length >= times ? asked[0]! : null;
  });

const openOf = (threadId: string) =>
  Effect.flatMap(World, ({ world }) => Context.get(world.runtime.owners, ThreadHarness).runs.questions().open(threadId));

const inAttention = (threadId: string) =>
  Effect.flatMap(World, ({ world }) =>
    Effect.map(world.op('read_attention', { limit: 20 }, ''), (answer) =>
      (answer.body as { readonly rows: readonly Row[] }).rows.some((row) => row.threadId === threadId),
    ),
  );

const quizzed = Effect.fnUntraced(function* (title: string, by: Readonly<Record<string, string>> = TUTOR) {
  const { account } = yield* World;
  const created = yield* op('create_thread', { title, account }, by);
  expect(created).toMatchObject({ status: 200 });
  const threadId = (yield* decodeSnapshot(created.body)).snapshot.thread.id;
  expect((yield* op('start_turn', { threadId, text: 'Quiz me.', key: `quiz-${threadId}` }, by)).body).toMatchObject({
    status: 'started',
  });
  return threadId;
});

const marked = (name: string, on: boolean, plugin = 'tutor') =>
  Effect.flatMap(World, ({ data }) =>
    Effect.promise(() => (on ? writeFile(join(data(plugin), name), '') : rm(join(data(plugin), name), { force: true }))),
  );

const attended = (threadId: string, shown: boolean) =>
  Effect.flatMap(World, ({ world }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const moved = yield* Queue.unbounded<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            listOf(world.runtime.owners).subscribeAttention((event) => {
              const subject = event.kind === 'row' ? event.row.id : event.kind === 'removed' ? event.threadId : threadId;
              if (subject === threadId) Queue.offerUnsafe(moved, undefined);
            }),
          ),
          (stop) => Effect.sync(stop),
        );
        while ((yield* inAttention(threadId)) !== shown) yield* Queue.take(moved);
      }),
    ),
  );

const ended = (threadId: string, start: Effect.Effect<unknown, unknown, World>) =>
  Effect.flatMap(World, ({ world }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const settled = yield* Queue.unbounded<string>();
        yield* Context.get(world.runtime.owners, ThreadHarness)
          .runs.settlements()
          .subscribe({
            name: `plugin question run ${threadId}`,
            at: 'after-stages',
            handle: (event) => (event.threadId === threadId ? Queue.offer(settled, event.status).pipe(Effect.asVoid) : Effect.void),
          });
        yield* start;
        return yield* Queue.take(settled);
      }),
    ),
  );

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('questions of a plugin’s threads', (it) => {
  it.effect('a tutor’s ask_user wakes the idle plugin, stays out of Attention, and the plugin’s answer_question lets the run go on', () =>
    Effect.gen(function* () {
      const threadId = yield* quizzed('tutor');
      const asked = yield* askedOf(threadId);
      expect(asked.prompts).toMatchObject([{ prompt: PROMPT }]);
      expect(yield* inAttention(threadId)).toBe(false);
      const answer = { threadId, questionId: asked.questionId, answers: [{ questionId: asked.prompts[0]!.id, values: ['Haus'] }] };
      const answered = Effect.tap(op('answer_question', answer, TUTOR), (sent) =>
        Effect.sync(() => expect(sent.body).toMatchObject({ status: 'started' })),
      );
      expect(yield* ended(threadId, answered)).toBe('completed');
    }),
  );

  it.effect('a question the plugin leaves, or whose delivery fails, stands with the person in Attention, recorded on the question', () =>
    Effect.gen(function* () {
      for (const mark of ['leave', 'fail-asked']) {
        yield* marked(mark, true);
        const threadId = yield* quizzed(mark);
        yield* askedOf(threadId);
        yield* attended(threadId, true);
        expect((yield* openOf(threadId)).map((entry) => [entry.approver, entry.declinedBy])).toEqual([[undefined, 'plugin:tutor']]);
        yield* marked(mark, false);
      }
    }),
  );

  it.effect('a question the plugin leaves on a thread under the person’s own goes to the person, not to that parent', () =>
    Effect.gen(function* () {
      const { account } = yield* World;
      const parent = yield* op('create_thread', { title: 'my own', account });
      expect(parent.status).toBe(200);
      const parentId = (yield* decodeSnapshot(parent.body)).snapshot.thread.id;
      yield* marked('leave', true);
      yield* Effect.addFinalizer(() => marked('leave', false));
      const child = yield* op('create_thread', { parent: parentId, task: 'Quiz me.' }, TUTOR);
      expect(child).toMatchObject({ status: 200 });
      const threadId = (yield* decodeSnapshot(child.body)).snapshot.thread.id;
      yield* askedOf(threadId);
      yield* attended(threadId, true);
    }),
  );

  it.effect('switching the plugin off hands its open question to the person, and on again hands it back to the plugin', () =>
    Effect.gen(function* () {
      const threadId = yield* quizzed('switched off');
      yield* askedOf(threadId);
      expect(yield* inAttention(threadId)).toBe(false);
      expect((yield* op('enable_plugin', { id: 'tutor', enabled: false, scope: 'project' })).status).toBe(200);
      yield* Effect.addFinalizer(() => op('enable_plugin', { id: 'tutor', enabled: true, scope: 'project' }).pipe(Effect.orDie));
      yield* attended(threadId, true);
      expect((yield* op('enable_plugin', { id: 'tutor', enabled: true, scope: 'project' })).status).toBe(200);
      yield* askedOf(threadId, 'tutor', 2);
      expect(yield* inAttention(threadId)).toBe(false);
    }),
  );

  it.effect('a resident plugin that breaks after taking a question hands it to the person, and takes it again once it runs', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* World;
      const host = Context.get(world.runtime.owners, PluginHost);
      yield* installedFixture(world, projectId, { id: 'coach', resident: true, contributes: { on: { asked: 'asked' } } });
      const threadId = yield* quizzed('coached', COACH);
      yield* askedOf(threadId, 'coach');
      expect(yield* inAttention(threadId)).toBe(false);
      yield* marked('refuse', true, 'coach');
      yield* Effect.addFinalizer(() => marked('refuse', false, 'coach'));
      yield* Effect.exit(host.call('coach', 'crash', {}, {}));
      yield* attended(threadId, true);
      yield* marked('refuse', false, 'coach');
      yield* askedOf(threadId, 'coach', 2);
      expect(yield* inAttention(threadId)).toBe(false);
    }),
  );
});
