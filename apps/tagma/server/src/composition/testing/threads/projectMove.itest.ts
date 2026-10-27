import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, FileSystem, Stream } from 'effect';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

const fixture = doorFixture();
const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const call = (id: string, name: string, input: unknown): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id, name },
  { type: 'tool-call', id, name, input },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];
const answer: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'done' },
  { type: 'text-delta', id: 'done', text: 'Done.' },
  { type: 'text-end', id: 'done' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];
const resultOf = (input: ModelStreamInput, id: string) =>
  input.messages
    .flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-result' && part.id === id ? [part.result] : [])))
    .at(-1);

const scripted =
  (steps: (input: ModelStreamInput, said: string) => Effect.Effect<LLMEvent[]>) =>
  (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
    ...standing,
    request: (selection: ModelRequestInput) =>
      ({
        system: selection.instructions,
        origin: new ModelIdentity({
          provider: ProviderID.make(selection.provider ?? 'scripted'),
          model: ModelID.make(selection.model ?? 'scripted'),
        }),
        plannedOutputTokens: 32,
        text: () => Effect.die(new Error('the scripted model answers streamed requests only')),
        object: () => Effect.die(new Error('the scripted model answers streamed requests only')),
        stream: (input: ModelStreamInput) =>
          Stream.unwrap(Effect.map(steps(input, JSON.stringify(input.messages)), (events) => Stream.fromIterable(events))),
      }) as ReturnType<ModelAccess['Service']['request']>,
  });

const projects = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const opened = Effect.gen(function* () {
    const root = yield* files.realPath(yield* world.directory('home'));
    yield* suiteGit(root, 'init', '-q', '-b', 'main');
    yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
    const id = yield* world.stealthProject(root);
    yield* Context.get(world.runtime.workspace, Coverage).cover(id);
    const law = yield* world.op('create_block', { tags: ['rule'], title: `Law of ${root}` }, `project=${id}`);
    if (law.status !== 200) return yield* Effect.die(new Error(`the law was not written: ${JSON.stringify(law.body)}`));
    return { id, root, law: (law.body as { block: { name: string } }).block.name };
  });
  const from = yield* opened;
  const to = yield* opened;
  yield* projectLeaving(world, from.id, to.id);
  const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${from.id}`);
  const thread = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  const listed = (project: number) =>
    Effect.map(world.op('list_threads', { ids: [thread] }, `project=${project}`), (read) =>
      read.status === 200 ? (read.body as { total: number }).total : (read.body as { code: string }).code,
    );
  return { world, from, to, thread, listed };
});

it.live(
  'the operator moves an idle thread into another project: it is listed there, keeps its own command rules and its next step works under that project’s law in its checkout',
  () =>
    Effect.gen(function* () {
      const ASK = 'Say where you stand now.';
      const told: string[] = [];
      const answered = yield* Deferred.make<ModelStreamInput>();
      const world = yield* DoorFixture;
      yield* world.lend({
        models: scripted((input, said) =>
          Effect.gen(function* () {
            if (!said.includes(ASK)) return answer;
            if (resultOf(input, 'where') === undefined) {
              told.push(said);
              return call('where', 'bash', { command: 'pwd', description: 'Print the working directory' });
            }
            yield* Deferred.succeed(answered, input);
            return answer;
          }),
        ),
      });
      const { from, to, thread, listed } = yield* projects;
      const written = yield* world.op(
        'write_command_rule',
        { reach: 'thread', thread, measure: 'life', limitMs: 60_000, words: 'Keep its commands short.' },
        `project=${from.id}`,
      );
      expect(written.status).toBe(200);
      const rule = (written.body as { rule: { id: string } }).rule.id;
      expect((yield* world.op('move_thread', { threadId: thread, home: to.id }, `project=${from.id}`)).body).toMatchObject({
        status: 'selected',
        threadId: thread,
        projectId: to.id,
      });
      expect([yield* listed(from.id), yield* listed(to.id)]).toEqual(['place-mismatch', 1]);
      const rules = (yield* world.op('read_command_rules', { reach: 'thread', thread }, `project=${to.id}`)).body as {
        rules: readonly { id: string; thread: string | null; project: number | null }[];
      };
      expect(rules.rules.filter((row) => row.thread === thread).map((row) => [row.id, row.project])).toEqual([[rule, to.id]]);
      yield* turnsOf(world.runtime.owners).send(thread, to.id, ASK);
      const finished = yield* Deferred.await(answered);
      expect(told[0]).toContain(to.law);
      expect(told[0]).not.toContain(from.law);
      expect(JSON.stringify(resultOf(finished, 'where'))).toContain(to.root);
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(fixture)),
);

it.live('an agent moves itself into another project mid-turn and its next step is told that project’s law', () =>
  Effect.gen(function* () {
    const ASK = 'Move yourself into the other project.';
    const self: { thread: string; home: number } = { thread: '', home: 0 };
    const told: string[] = [];
    const answered = yield* Deferred.make<ModelStreamInput>();
    const world = yield* DoorFixture;
    yield* world.lend({
      models: scripted((input, said) =>
        Effect.gen(function* () {
          if (!said.includes(ASK)) return answer;
          told.push(said);
          if (resultOf(input, 'reveal') === undefined) return call('reveal', 'tool_search', { query: 'select:move_thread' });
          if (resultOf(input, 'move') === undefined) return call('move', 'move_thread', { threadId: self.thread, home: String(self.home) });
          yield* Deferred.succeed(answered, input);
          return answer;
        }),
      ),
    });
    const { from, to, thread, listed } = yield* projects;
    self.thread = thread;
    self.home = to.id;
    yield* turnsOf(world.runtime.owners).send(thread, from.id, ASK);
    const finished = yield* Deferred.await(answered);
    expect(JSON.stringify(resultOf(finished, 'move'))).toContain('pending');
    expect(told[0]).toContain(from.law);
    expect(told[0]).not.toContain(to.law);
    expect(told.at(-1)).toContain(to.law);
    expect([yield* listed(from.id), yield* listed(to.id)]).toEqual(['place-mismatch', 1]);
  }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(fixture)),
);
