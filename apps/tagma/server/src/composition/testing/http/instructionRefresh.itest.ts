import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, FileSystem, Queue, Schema, Stream } from 'effect';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { agentDefinitionSchema, agentPreviewSchema } from '../../../threads/contract/wire/agentLibrary.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { acpTestSeat } from '../../../external-harnesses/testing/seats.js';
import { HARNESS_AGENT_ID, type HarnessName } from '../../../threads/contract/wire/harness/names.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { threadStack } from '../threadParts.js';

type Request = { readonly runId: string | undefined; readonly instructions: string; readonly tools: readonly string[] };

it.live('refresh adopts the current definition for the next run and preserves it when a later definition cannot be read', () =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<Request>();
    const release = yield* Deferred.make<void>();
    const usage = new Usage({
      inputTokens: 1,
      nonCachedInputTokens: 1,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 2,
    });
    const events: LLMEvent[] = [
      { type: 'step-start', index: 0 },
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', text: 'Done.' },
      { type: 'text-end', id: 'answer' },
      { type: 'step-finish', index: 0, reason: 'stop' },
      { type: 'finish', reason: 'stop', usage },
    ];
    const world = yield* makeDoorWorld({
      models: (standing) => ({
        ...standing,
        request: (selection) => ({
          system: selection.instructions,
          plannedOutputTokens: 1,
          text: () => Effect.die('streamed requests only'),
          object: () => Effect.die('streamed requests only'),
          stream: (input) =>
            Stream.unwrap(
              Effect.as(
                Effect.andThen(
                  Queue.offer(requests, {
                    runId: selection.runId,
                    instructions: selection.instructions ?? '',
                    tools: Object.keys(input.tools),
                  }),
                  Deferred.await(release),
                ),
                Stream.fromIterable(events),
              ),
            ),
        }),
      }),
    });
    const root = yield* world.directory('refresh');
    const projectId = yield* world.stealthProject(root);
    yield* projectLeaving(world, projectId);
    const query = `project=${projectId}`;
    const op = (id: string, input: unknown) => world.op(id, input, query);
    const source = (body: string, capabilities: string, tools = 'read', section = 'writing') =>
      `---\nextends: tagma\ncapabilities: [${capabilities}]\ntools: [${tools}]\nsections:\n  - replace: ${section}\n    text: ${body}-identity\n---\n${body}-overlay\n`;
    const original = yield* op('save_agent', { name: 'reader', scope: 'project', revision: null, source: source('first', '') });
    expect(original.status).toBe(200);
    const first = yield* Schema.decodeUnknownEffect(agentDefinitionSchema)(original.body);
    const born = yield* op('create_thread', { type: 'reader', approvalMode: 'bypass' });
    expect(born.status).toBe(200);
    const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
    const harness = Context.get(world.runtime.owners, ThreadHarness);
    const ended = yield* Queue.unbounded<string>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        harness.reads.subscribeStates((state) => {
          if (state.thread.id === threadId && state.activeRun === null && state.latestRun !== null)
            Queue.offerUnsafe(ended, state.latestRun.id);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const run = Effect.fnUntraced(function* (key: string) {
      const sent = yield* op('start_turn', { threadId, text: key, key });
      expect(sent.status).toBe(200);
      return (sent.body as { runId: string }).runId;
    });
    const finished = (runId: string) => Stream.runHead(Stream.filter(Stream.fromQueue(ended), (id) => id === runId));
    const requestOf = (runId: string) =>
      Stream.runHead(Stream.filter(Stream.fromQueue(requests), (request) => request.runId === runId)).pipe(
        Effect.flatMap(Effect.fromOption),
      );
    const changed = yield* op('save_agent', {
      name: 'reader',
      scope: 'project',
      revision: first.origin.revision,
      source: source('second', 'files'),
    });
    expect(changed.status).toBe(200);
    const definition = yield* Schema.decodeUnknownEffect(agentDefinitionSchema)(changed.body);
    const preview = yield* op('read_agent', { id: 'reader' });
    const current = yield* Schema.decodeUnknownEffect(agentPreviewSchema)(preview.body);
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ status: 200, body: { status: 'updated' } });
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ status: 200, body: { status: 'current' } });
    const firstRun = yield* run('first');
    const held = yield* requestOf(firstRun);
    expect(held.instructions).toBe(current.prompt.text);
    expect(held.tools).not.toContain('ls');
    const saved = yield* op('read_thread_agent', { threadId });
    const frozen = (yield* Schema.decodeUnknownEffect(agentPreviewSchema)(saved.body)).prompt.text;
    const expanded = yield* op('save_agent', {
      name: 'reader',
      scope: 'project',
      revision: definition.origin.revision,
      source: source('second', 'files', 'read, ls'),
    });
    expect(expanded.status).toBe(200);
    const expandedDefinition = yield* Schema.decodeUnknownEffect(agentDefinitionSchema)(expanded.body);
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ status: 200, body: { status: 'updated' } });
    const reordered = yield* op('save_agent', {
      name: 'reader',
      scope: 'project',
      revision: expandedDefinition.origin.revision,
      source: source('second', 'files', 'ls, read'),
    });
    expect(reordered.status).toBe(200);
    const reorderedDefinition = yield* Schema.decodeUnknownEffect(agentDefinitionSchema)(reordered.body);
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ status: 200, body: { status: 'current' } });
    const invalid = yield* op('save_agent', {
      name: 'reader',
      scope: 'project',
      revision: reorderedDefinition.origin.revision,
      source: source('invalid', '', 'read', 'missing-section'),
    });
    expect(invalid.status).toBe(200);
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ body: { code: 'agent-invalid' } });
    if (definition.origin.path === null) return yield* Effect.die('the saved declaration has no file');
    yield* (yield* FileSystem.FileSystem).remove(definition.origin.path);
    expect(yield* op('refresh_thread_instructions', { threadId })).toMatchObject({ body: { code: 'agent-not-found' } });
    const unchanged = yield* op('read_thread_agent', { threadId });
    const retained = yield* Schema.decodeUnknownEffect(agentPreviewSchema)(unchanged.body);
    expect(retained.prompt.text).toBe(frozen);
    expect(retained.definition.config.tools).toEqual(['read']);
    yield* Deferred.succeed(release, undefined);
    yield* finished(firstRun);
    expect(yield* harness.threads.handle(threadId, OPERATOR_PRINCIPAL).keepWarm('refresh-warm')).toEqual({ status: 'prompt-pending' });
    const nextRun = yield* run('second');
    const next = yield* requestOf(nextRun);
    expect(next.instructions).toBe(current.prompt.text);
    expect(next.tools).toContain('ls');
    yield* finished(nextRun);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live(
  'a harness thread serving a Tagma agent refreshes as that agent and stays a harness thread; one running its own agent refuses',
  () =>
    Effect.gen(function* () {
      const world = yield* makeDoorWorld();
      const projectId = yield* world.stealthProject(yield* world.directory('hosted-refresh'));
      yield* projectLeaving(world, projectId);
      const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
      const saved = yield* op('save_agent', {
        name: 'reader',
        scope: 'project',
        revision: null,
        source: '---\nextends: tagma\n---\nreader-overlay\n',
      });
      expect(saved.status).toBe(200);
      const records = yield* Effect.provide(makeThreadRecords, world.runtime.owners);
      const { store, threads } = yield* Effect.provide(
        threadStack({
          db: Context.get(world.runtime.owners, MachineStore).db,
          units: Context.get(world.runtime.owners, MachineUnits),
          records,
          kinds: ENTRY_KINDS,
        }),
        world.runtime.owners,
      );
      const seated = (harness: HarnessName, agent: string | null) =>
        store.transaction((tx) =>
          Effect.gen(function* () {
            const row = yield* store.insert(
              {
                ownerId: 'operator',
                agentId: HARNESS_AGENT_ID,
                provider: 'claude-code',
                profile: { id: 'reader', overlay: { id: 'reader', baseAgentId: 'tagma', description: '' } },
              },
              tx,
            );
            yield* threads.rows.attachFacet({ threadId: row.id, projectId, harness: acpTestSeat(harness, agent, undefined) }, tx);
            return row.id;
          }),
        );
      const hosted = yield* seated('claude-code', 'tagma');
      expect(yield* op('refresh_thread_instructions', { threadId: hosted })).toMatchObject({ status: 200, body: { status: 'updated' } });
      const pending = yield* store.systemPromptOf(hosted);
      expect(pending?.pendingDefinition).toMatchObject({ agentId: HARNESS_AGENT_ID, profile: { id: 'reader' } });
      expect(pending?.pendingSystemPrompt).toContain('reader-overlay');
      const own = yield* seated('devin', null);
      expect(yield* op('refresh_thread_instructions', { threadId: own })).toMatchObject({ body: { code: 'external-context' } });
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
