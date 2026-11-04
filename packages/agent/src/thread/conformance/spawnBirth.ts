import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { Message } from '@runlith/llm/schema/messages';
import { Effect, Schema, type Scope } from 'effect';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { planeRefusalOf } from '../../collaboration/planeRefusal';
import { threadCauseOf } from '../ThreadBorder';
import { processTurn, replyTurn, scriptedStep } from './runLog/scripts';
import { dyingToolTurn } from './runLog/toolScripts';
import { transcriptOf, until } from './runLog/support';
import { scriptedWorld, type ScriptedWorld } from './runLog/world';
import type { ThreadBindings, ToolCaller } from '../../agent/contracts';
import type { ThreadStorageFactory } from './storagePort';
import { ASKS_NEVER } from '../../permissions/vocabulary';
const OWNER = 'owner';
const SCOPE = 'scope-a';
const TASK = 'Read the failing test and report';
export function describeThreadSpawnBirth<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: spawn birth`, () => {
    test(
      'two callers on one request id are answered about one child',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent } = stack;
        world.plan.push(reply('Read it.'));
        const both = yield* Effect.all([spawn(world, parent, stack.agentId, 'call-1'), spawn(world, parent, stack.agentId, 'call-1')], {
          concurrency: 2,
        });
        const children = yield* world.harness.threads.handle(parent, OWNER).listChildren();
        expect(children).toHaveLength(1);
        expect(both.map((answer) => answer.threadId)).toEqual([children[0]!.threadId, children[0]!.threadId]);
      }),
    );
    test(
      'a different payload under a decided request id refuses',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent } = stack;
        world.plan.push(reply('Read it.'));
        const started = yield* spawn(world, parent, stack.agentId, 'call-1');
        const conflict = yield* Effect.flip(spawn(world, parent, stack.agentId, 'call-1', 'Do something else entirely'));
        expect(planeRefusalOf(conflict)?.code).toBe('spawn-conflict');
        const children = yield* world.harness.threads.handle(parent, OWNER).listChildren();
        expect(children.map((child) => child.threadId)).toEqual([started.threadId]);
      }),
    );
    test(
      'the bindings a spawn names are the child’s own, and a storage reopened over the same state reads them back',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent, storage } = stack;
        world.plan.push(reply('Seated.'));
        const started = yield* spawn(world, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s5' });
        yield* world.dispose();
        const reopened = yield* Effect.acquireRelease(storage.reopen(), (storage) => storage.dispose());
        const after = yield* scriptedWorld(reopened, stack.agentId, { models: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS) });
        expect((yield* reopened.aggregate.metadata(started.threadId))?.bindings).toEqual({ poker: 't3/s5' });
        expect((yield* after.harness.reads.snapshot(started.threadId)).thread.bindings).toEqual({ poker: 't3/s5' });
      }),
    );
    test(
      'a call a thread born with bindings left unfinished is settled with the caller it had, over a reopened storage',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world: before, parent, storage } = stack;
        const seen: ToolCaller[] = [];
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () => Effect.succeed({ written: true }),
            settleEffect: (call) =>
              Effect.sync(() => {
                seen.push(call.caller);
                return { status: 'completed' as const, output: { written: 'before the death' } };
              }),
          }),
        };
        const dying = yield* scriptedWorld(storage, stack.agentId, { catalog, models: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS) });
        dying.plan.push(dyingToolTurn());
        const child = yield* spawn(dying, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s5' });
        yield* until(() => Effect.map(transcriptOf(storage, child.threadId), (entries) => entries.some((entry) => entry.type === 'tool')));
        const run = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(child.threadId);
        yield* dying.dispose();
        yield* before.dispose();
        const reopened = yield* Effect.acquireRelease(storage.reopen(), (storage) => storage.dispose());
        const recovering = yield* scriptedWorld(reopened, stack.agentId, { catalog });
        recovering.plan.push(processTurn(Effect.never));
        expect(yield* recovering.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.sync(() => seen.length > 0));
        const row = yield* reopened.aggregate.metadata(child.threadId);
        expect(seen).toEqual([
          {
            agentId: row!.agentId,
            ownerId: OWNER,
            thread: { threadId: child.threadId, runId: run!.id, bindings: { poker: 't3/s5' } },
          },
        ]);
      }),
    );
    test(
      'a request id replayed with other bindings is a conflict, and the same bindings answer the standing child',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent } = stack;
        world.plan.push(reply('Seated.'));
        const started = yield* spawn(world, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s5' });
        const again = yield* spawn(world, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s5' });
        const conflict = yield* Effect.flip(spawn(world, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s6' }));
        expect(again.threadId).toBe(started.threadId);
        expect(planeRefusalOf(conflict)?.code).toBe('spawn-conflict');
        expect(yield* world.harness.threads.handle(parent, OWNER).listChildren()).toHaveLength(1);
      }),
    );
    test(
      'a fork carries no bindings unless its birther names them',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent, storage } = stack;
        world.plan.push(reply('Seated.'));
        const seated = yield* spawn(world, parent, stack.agentId, 'call-1', TASK, { poker: 't3/s5' });
        const plain = yield* world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: seated.threadId });
        const named = yield* world.harness.threads.duplicate({
          ownerId: OWNER,
          sourceThreadId: seated.threadId,
          bindings: { poker: 't3/s6' },
        });
        expect(plain.bindings).toEqual({});
        expect(named.bindings).toEqual({ poker: 't3/s6' });
        expect((yield* storage.aggregate.metadata(plain.id))?.bindings).toEqual({});
        expect((yield* storage.aggregate.metadata(named.id))?.bindings).toEqual({ poker: 't3/s6' });
      }),
    );
    test(
      'a spawn forking a child’s history is born the caller’s child, carrying what that child said',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent, storage } = stack;
        world.plan.push(reply('Mapped the module.'), reply('Taking it from the map.'));
        const source = yield* spawn(world, parent, stack.agentId, 'call-1');
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* until(() => Effect.map(runs.latestRun(source.threadId), (run) => run?.status === 'completed'));
        const forked = yield* world.harness.collaboration.collaborate(parent, OWNER, (verbs) =>
          verbs.spawn({
            requestId: 'call-2',
            agentId: stack.agentId,
            task: 'Write section seven.',
            fork: { kind: 'all' },
            forkFrom: source.threadId,
          }),
        );
        expect(forked.threadId).not.toBe(source.threadId);
        expect((yield* storage.aggregate.metadata(forked.threadId))?.parentThreadId).toBe(parent);
        const carried = yield* transcriptOf(storage, forked.threadId);
        expect(
          carried.some(
            (entry) =>
              entry.type === 'message' &&
              (
                entry as {
                  text?: string;
                }
              ).text === 'Mapped the module.',
          ),
        ).toBe(true);
      }),
    );
    test(
      'a spawn forking another tree’s thread a harness hosts for the same agent keeps the system prompt and cache group it runs under',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent, storage } = stack;
        const source = yield* storage.createThread({
          ownerId: OWNER,
          scope: SCOPE,
          transport: { adapter: 'acp', profile: 'claude-code', agent: stack.agentId },
        });
        yield* storage.aggregate.update(source.id, {
          agentId: 'harness',
          systemPrompt: 'The prompt the hosted session was opened with.',
        });
        const forked = yield* world.harness.collaboration.collaborate(parent, OWNER, (verbs) =>
          verbs.spawn({ requestId: 'call-1', agentId: stack.agentId, task: TASK, fork: { kind: 'all' }, forkFrom: source.id }),
        );
        const child = yield* storage.aggregate.find(forked.threadId);
        expect(child?.parentThreadId).toBe(parent);
        expect(child?.systemPrompt).toBe('The prompt the hosted session was opened with.');
        expect(child?.cacheGroup).toBe(source.cacheGroup);
      }),
    );
    test(
      'a named host binding no hook admits refuses, and no child is born',
      Effect.fnUntraced(function* () {
        const stack = yield* openedSpawn(open);
        const { world, parent } = stack;
        const refusal = yield* Effect.flip(
          world.harness.collaboration.spawn({
            parentThreadId: parent,
            ownerId: OWNER,
            requestId: 'call-1',
            agentId: stack.agentId,
            task: TASK,
            host: { kind: 'workspace', id: 'ws-1' },
          }),
        );
        expect(threadCauseOf(refusal)).toMatchObject({ _tag: 'BirthRefused', reason: 'host-unadmitted' });
        expect(yield* world.harness.threads.handle(parent, OWNER).listChildren()).toEqual([]);
      }),
    );
  });
}
function spawn(world: ScriptedWorld, parentThreadId: string, agentId: string, requestId: string, task = TASK, bindings?: ThreadBindings) {
  return world.harness.collaboration.spawn({ parentThreadId, ownerId: OWNER, requestId, agentId, task, bindings });
}
function reply(text: string) {
  return replyTurn({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text },
      { type: 'text-end', id: 't1' },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
}
const openedSpawn = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx, R = never>(open: ThreadStorageFactory<TTx, TWrite, R>) {
  const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const world = yield* scriptedWorld(storage, thread.agentId, { models: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS) });
  return { world, storage, parent: thread.id, agentId: thread.agentId };
});
