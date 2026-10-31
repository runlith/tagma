import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import type { ThreadState } from '@runlith/agent/thread/state';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import { wireToolDefinitions } from '@runlith/agent/ModelRequests';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, Exit, FileSystem, Schema, Stream } from 'effect';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { COLLABORATION_OPERATIONS } from '../../../threads/contract/wire/operations/collaboration.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
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
const answer: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'done' },
  { type: 'text-delta', id: 'done', text: 'Done.' },
  { type: 'text-end', id: 'done' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

type Asked = {
  readonly lane: string | undefined;
  readonly stepped: boolean;
  readonly system: string | undefined;
  readonly tools: readonly ToolDefinition[];
  readonly messages: readonly Message[];
};

const recording =
  (asked: Asked[]) =>
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
          Stream.unwrap(
            Effect.sync(() => {
              asked.push({
                lane: selection.lane,
                stepped: input.step !== undefined,
                system: selection.instructions,
                tools: wireToolDefinitions(input.tools, input.activeTools),
                messages: input.messages,
              });
              return Stream.fromIterable(answer);
            }),
          ),
      }) as ReturnType<ModelAccess['Service']['request']>,
  });

const decodeSpawn = Schema.decodeUnknownEffect(knownAnswer(COLLABORATION_OPERATIONS.spawn_agent.answer));

const project = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('forked'));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
  const id = yield* world.stealthProject(root);
  yield* Context.get(world.runtime.workspace, Coverage).cover(id);
  yield* projectLeaving(world, id);
  return id;
});

const idle = Effect.fn('testing.forkNoticeIdle')(function* (threadId: string, runId: string | null) {
  const reads = Context.get((yield* DoorFixture).runtime.owners, ThreadHarness).reads;
  const done = (state: ThreadState) =>
    state.activeRun === null && state.latestRun !== null && (runId === null || state.latestRun.id === runId);
  const seen = yield* Deferred.make<ThreadState>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      reads.subscribeStates((state) => {
        if (state.thread.id === threadId && done(state)) Deferred.doneUnsafe(seen, Exit.succeed(state));
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  const current = yield* reads.snapshot(threadId);
  return done(current) ? current.latestRun : (yield* Deferred.await(seen)).latestRun;
}, Effect.scoped);

const wire = (messages: readonly Message[]) => JSON.stringify(messages);

const naming = (messages: readonly Message[], threadId: string) => wire(messages).split(threadId).length - 1;

it.live(
  'a fork made by the operator or by spawn_agent is told once, on its first turn, whose copy it is, and that turn reads its source’s system prompt and history unchanged',
  () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const world = yield* DoorFixture;
      yield* world.lend({ models: recording(asked) });
      const projectId = yield* project;
      const at = `project=${projectId}`;
      const turns = turnsOf(world.runtime.owners);
      const turn = Effect.fnUntraced(function* (threadId: string, words: string) {
        const { runId } = yield* turns.send(threadId, projectId, words);
        expect((yield* idle(threadId, runId))?.status).toBe('completed');
      });
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, at);
      const source = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      yield* turn(source, 'Read the module.');

      const branched = yield* world.op('branch_thread', { threadId: source }, at);
      expect(branched.status).toBe(200);
      const branch = String((branched.body as { readonly threadId: string }).threadId);
      yield* turn(branch, 'Say what it does.');
      yield* turn(branch, 'Say it again.');

      const spawner = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
        .id;
      const spawn = (input: object) =>
        world.op('spawn_agent', input, at, { [GRANT_HEADER]: grantFor(spawner), [APPROVAL_WAIT_HEADER]: '0' });
      const ask = { agentId: 'tagma', task: 'Say what it does.', fork: 'all', forkFrom: source };
      const first = (yield* spawn(ask)).body;
      const started = yield* decodeSpawn(
        Schema.is(refusalSchema)(first) && first.code === 'instructions-unread' ? (yield* spawn(ask)).body : first,
      );
      if (started.status !== 'started') return yield* Effect.die(new Error(`the spawn was ${started.status}`));
      yield* idle(started.threadId, null);
      yield* turn(source, 'Read it again.');

      const of = (lane: string) => asked.filter((request) => request.lane === lane && request.stepped);
      const [parent, again] = of(source);
      const [opened, next] = of(branch);
      const [child] = of(started.threadId);
      if (parent === undefined || again === undefined || opened === undefined || next === undefined || child === undefined) {
        return yield* Effect.die(new Error(`requests by thread: ${JSON.stringify(asked.map((request) => request.lane))}`));
      }
      const copied = parent.messages.length + 1;
      for (const fork of [opened, child]) {
        expect(JSON.stringify([fork.system, fork.tools])).toBe(JSON.stringify([again.system, again.tools]));
        expect(wire(fork.messages.slice(0, copied))).toBe(wire(again.messages.slice(0, copied)));
        expect(naming(fork.messages.slice(copied), source)).toBe(1);
      }
      expect(wire(next.messages.slice(0, opened.messages.length))).toBe(wire(opened.messages));
      expect(naming(next.messages.slice(opened.messages.length), source)).toBe(0);
    }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(fixture)),
);
