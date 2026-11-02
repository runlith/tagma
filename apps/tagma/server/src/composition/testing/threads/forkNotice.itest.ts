import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import type { ThreadState } from '@runlith/agent/thread/state';
import { Message, type ToolDefinition } from '@runlith/llm/schema/messages';
import { wireToolDefinitions } from '@runlith/agent/ModelRequests';
import { discoveredToolNames } from '@runlith/agent/AgentDeferredTools';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, Exit, FileSystem, Schema, Stream } from 'effect';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { COLLABORATION_OPERATIONS } from '../../../threads/contract/wire/operations/collaboration.js';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { modelDefaults, subscriptionLogin } from '../claudeLogin.js';
import { Compaction } from '../../../native-harness/contract/service/context.js';

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
const SUMMARY =
  'The source loaded the artifacts skill, revealed the deferred thread record tool, and completed its module reading. Continue the same task with the retained tool references, preserving the copied system prompt and every remaining message in order.';
const answer: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'done' },
  { type: 'text-delta', id: 'done', text: 'Done.' },
  { type: 'text-end', id: 'done' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

const discovery: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'reasoning-start', id: 'thinking' },
  { type: 'reasoning-delta', id: 'thinking', text: 'Keep the signed reasoning.' },
  { type: 'reasoning-end', id: 'thinking', providerMetadata: { anthropic: { signature: 'signed-source-reasoning' } } },
  { type: 'tool-call', id: 'discover', name: 'tool_search', input: { query: 'select:read_thread_record' } },
  { type: 'tool-call', id: 'skill', name: 'load_skill', input: { skill: 'artifacts' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];

type Asked = {
  readonly lane: string | undefined;
  readonly selection: Omit<ModelRequestInput, 'lane' | 'runId' | 'instructions'>;
  readonly stepped: boolean;
  readonly system: string | undefined;
  readonly tools: readonly ToolDefinition[];
  readonly messages: readonly Message[];
};

const recording =
  (asked: Asked[], landed: (request: Asked) => void) =>
  (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
    ...standing,
    request: (selection: ModelRequestInput) =>
      ({
        system: selection.instructions,
        origin: new ModelIdentity({
          provider: ProviderID.make(selection.provider ?? 'scripted'),
          model: ModelID.make(selection.model ?? 'scripted'),
        }),
        plannedOutputTokens: 128,
        text: () =>
          Effect.succeed(
            new LLMResponse({
              message: Message.assistant(SUMMARY),
              events: [{ type: 'text-delta', id: 'summary', text: SUMMARY }],
              usage,
              finishReason: 'stop',
            }),
          ),
        object: () => Effect.die(new Error('the scripted model answers streamed requests only')),
        stream: (input: ModelStreamInput) =>
          Stream.unwrap(
            Effect.sync(() => {
              const { lane, runId: _runId, instructions: _instructions, ...identity } = selection;
              const first = input.step !== undefined && !asked.some((request) => request.stepped);
              asked.push({
                lane,
                selection: identity,
                stepped: input.step !== undefined,
                system: selection.instructions,
                tools: wireToolDefinitions(input.tools, input.activeTools),
                messages: input.messages,
              });
              landed(asked.at(-1)!);
              return Stream.fromIterable(first ? discovery : answer);
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

it.live('native forks preserve request bytes across birth doors, history cuts and compaction', () =>
  Effect.gen(function* () {
    const asked: Asked[] = [];
    const world = yield* DoorFixture;
    let landed: (request: Asked) => void = () => {};
    yield* world.lend({ models: recording(asked, (request) => landed(request)) });
    const account = yield* subscriptionLogin(world);
    yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account });
    const projectId = yield* project;
    const at = `project=${projectId}`;
    const turns = turnsOf(world.runtime.owners);
    const turn = Effect.fnUntraced(function* (threadId: string, words: string) {
      const { runId } = yield* turns.send(threadId, projectId, words);
      expect((yield* idle(threadId, runId))?.status).toBe('completed');
      return runId;
    });
    const definition = yield* world.op(
      'save_agent',
      {
        name: 'fork-profile',
        scope: 'project',
        revision: null,
        source: '---\ndescription: Fork prefix oracle\nextends: tagma\n---\nKeep the source request.\n',
      },
      at,
    );
    expect(definition.status).toBe(200);
    expect((yield* world.op('write_setting', { key: 'agent.offered', value: [{ type: 'fork-profile', to: 'agents' }] }, at)).status).toBe(
      200,
    );
    const born = yield* world.op(
      'create_thread',
      {
        type: 'fork-profile',
        approvalMode: 'bypass',
        account,
        switches: { reasoningDisplay: 'omitted' },
        team: {
          models: [{ provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', on: true, favor: 4 }],
          review: { reviewers: 0, lenses: [] },
        },
      },
      at,
    );
    expect(born.status).toBe(200);
    const source = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
    const firstRun = yield* turn(source, 'Read the module.');
    const copied = (yield* Context.get(world.runtime.owners, NativeStorage).threads.historyOf(source))?.length ?? 0;
    expect(copied).toBeGreaterThan(0);
    expect(
      (yield* world.op(
        'save_agent',
        {
          name: 'fork-profile',
          scope: 'project',
          revision: (definition.body as { origin: { revision: string } }).origin.revision,
          source: '---\ndescription: Fork prefix oracle\nextends: tagma\ntools: [read]\n---\nUse the revised definition.\n',
        },
        at,
      )).status,
    ).toBe(200);

    const branched = yield* world.op('branch_thread', { threadId: source }, at);
    expect(branched.status).toBe(200);
    const branch = String((branched.body as { readonly threadId: string }).threadId);
    yield* turn(branch, 'Say what it does.');
    yield* turn(branch, 'Say it again.');

    const spawner = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' })).thread
      .id;
    const spawn = (input: object, caller: string) =>
      world.op('spawn_agent', input, at, { [GRANT_HEADER]: grantFor(caller), [APPROVAL_WAIT_HEADER]: '0' });
    const forked = Effect.fnUntraced(function* (cut: 'all' | number | { before: string }, own = false, model?: string) {
      const caller = own ? source : spawner;
      const ask = { agentId: 'fork-profile', task: 'Say what it does.', fork: cut, forkFrom: own ? undefined : source, model };
      const first = (yield* spawn(ask, caller)).body;
      const started = yield* decodeSpawn(
        Schema.is(refusalSchema)(first) && first.code === 'instructions-unread' ? (yield* spawn(ask, caller)).body : first,
      );
      if (started.status !== 'started') return yield* Effect.die(new Error(`the spawn was ${started.status}`));
      yield* idle(started.threadId, null);
      return started.threadId;
    });
    const started = yield* forked('all');
    expect(
      (yield* world.op(
        'write_setting',
        {
          key: 'agent.models',
          value: [{ provider: 'subscription', model: 'claude-haiku-5-5', reasoning: 'low', on: true }],
        },
        at,
      )).status,
    ).toBe(200);
    const changed = yield* forked('all', false, 'claude-haiku-5-5');
    const changedRow = yield* Context.get(world.runtime.owners, NativeStorage).threads.metadata(changed);
    expect(changedRow?.profile?.overlay.tools).toEqual(['read']);
    expect(changedRow?.account).toBeNull();
    expect(changedRow?.switches).toEqual({});
    expect((yield* Context.get(world.runtime.owners, ThreadMandate).teamLineage(changed)).own).toBeNull();
    expect(asked.find((request) => request.lane === changed && request.stepped)?.tools.map((tool) => tool.name)).toEqual([
      'read',
      'send_message',
      'tool_search',
    ]);
    const secondRun = yield* turn(source, 'Say what it does.');

    const of = (lane: string) => asked.filter((request) => request.lane === lane && request.stepped);
    const [, ready, again] = of(source);
    expect(ready?.tools.some((tool) => tool.name === 'publish_artifact')).toBe(true);
    expect(ready?.tools.find((tool) => tool.name === 'read_thread_record')?.deferred).toBe(true);
    expect(ready?.messages.flatMap((message) => message.content).some((part) => part.type === 'reasoning')).toBe(true);
    const [opened, next] = of(branch);
    const [child] = of(started);
    if (again === undefined || opened === undefined || next === undefined || child === undefined) {
      return yield* Effect.die(new Error(`requests by thread: ${JSON.stringify(asked.map((request) => request.lane))}`));
    }
    for (const fork of [opened, child]) {
      expect(JSON.stringify([fork.selection, fork.system, fork.tools])).toBe(JSON.stringify([again.selection, again.system, again.tools]));
      expect(wire(fork.messages.slice(0, copied))).toBe(wire(again.messages.slice(0, copied)));
    }
    for (const fork of [opened, child]) expect(naming(fork.messages.slice(copied), source)).toBe(1);
    expect(wire(next.messages.slice(0, opened.messages.length))).toBe(wire(opened.messages));
    expect(naming(next.messages.slice(opened.messages.length), source)).toBe(0);
    const beforeSpawn = yield* forked({ before: secondRun });
    const beforeBranch = yield* world.op('branch_thread', { threadId: source, before: secondRun }, at);
    expect(beforeBranch.status).toBe(200);
    const beforeId = (beforeBranch.body as { threadId: string }).threadId;
    yield* turn(beforeId, 'Say what it does.');
    for (const id of [beforeSpawn, beforeId]) {
      const request = of(id)[0]!;
      expect(JSON.stringify([request.selection, request.system, request.tools])).toBe(
        JSON.stringify([again.selection, again.system, again.tools]),
      );
      expect(wire(request.messages.slice(0, copied))).toBe(wire(again.messages.slice(0, copied)));
    }
    const last = yield* forked(1);
    expect((yield* world.op('rewind_thread', { threadId: source, at: firstRun, scope: 'turn' }, at)).status).toBe(200);
    const kept = (yield* Context.get(world.runtime.owners, NativeStorage).threads.historyOf(source))?.length ?? 0;
    yield* turn(source, 'Say what it does.');
    const cutSource = of(source).at(-1)!;
    const cutFork = of(last)[0]!;
    expect(JSON.stringify([cutFork.selection, cutFork.system, cutFork.tools])).toBe(
      JSON.stringify([cutSource.selection, cutSource.system, cutSource.tools]),
    );
    expect(wire(cutFork.messages.slice(0, kept))).toBe(wire(cutSource.messages.slice(0, kept)));
    const compacted = yield* Context.get(world.runtime.owners, Compaction).compact(beforeId, projectId, {});
    expect(compacted.status).toBe('started');
    if (compacted.status !== 'started') return yield* Effect.die(new Error('The native compaction did not start.'));
    const compactionRun = yield* idle(beforeId, compacted.runId);
    if (compactionRun?.status !== 'completed') return yield* Effect.die(new Error(`Compaction failed: ${JSON.stringify(compactionRun)}`));
    const folded = (yield* Context.get(world.runtime.owners, NativeStorage).threads.historyOf(beforeId))!;
    expect(discoveredToolNames(folded).has('read_thread_record')).toBe(true);
    const compactFork = yield* world.op('branch_thread', { threadId: beforeId }, at);
    expect(compactFork.status).toBe(200);
    const foldedId = (compactFork.body as { threadId: string }).threadId;
    yield* turn(foldedId, 'Continue from the summary.');
    yield* turn(beforeId, 'Continue from the summary.');
    const sourceRequest = of(beforeId).at(-1)!;
    const forkRequest = of(foldedId)[0]!;
    expect(JSON.stringify([forkRequest.selection, forkRequest.system, forkRequest.tools])).toBe(
      JSON.stringify([sourceRequest.selection, sourceRequest.system, sourceRequest.tools]),
    );
    expect(wire(forkRequest.messages.slice(0, folded.length))).toBe(wire(sourceRequest.messages.slice(0, folded.length)));
    const ownPrefix = (yield* Context.get(world.runtime.owners, NativeStorage).threads.historyOf(source))!;
    const followed = yield* Deferred.make<Asked>();
    landed = (request) => {
      if (request.lane === source && request.stepped) Deferred.doneUnsafe(followed, Exit.succeed(request));
    };
    const own = yield* forked('all', true);
    const continued = yield* Deferred.await(followed);
    yield* idle(source, null);
    const ownRequest = of(own)[0]!;
    expect(JSON.stringify([ownRequest.selection, ownRequest.system, ownRequest.tools])).toBe(
      JSON.stringify([continued.selection, continued.system, continued.tools]),
    );
    expect(wire(ownRequest.messages.slice(0, ownPrefix.length))).toBe(wire(continued.messages.slice(0, ownPrefix.length)));
  }).pipe(Effect.provide(BunFileSystem.layer), Effect.provide(fixture)),
);
