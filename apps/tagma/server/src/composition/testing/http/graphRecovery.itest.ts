import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { suiteGit } from '../suiteGit.js';
import { join } from 'node:path';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, FileSystem, Layer, Stream } from 'effect';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { TreeMerges } from '../../../graph/tree/merges.js';
import { makeDoorWorld } from '../doorFixture.js';
import { holdThreads } from '../threadScope.js';

const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});

const scripted =
  (inspected: Deferred.Deferred<string>) =>
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
        text: () => Effect.die('streamed requests only'),
        object: () => Effect.die('streamed requests only'),
        stream: (input: ModelStreamInput) =>
          Stream.suspend(() => {
            const said = JSON.stringify(input.messages);
            const events: LLMEvent[] = said.includes('"type":"tool-result","id":"recovery"')
              ? [
                  { type: 'step-start', index: 0 },
                  { type: 'text-start', id: 'answer' },
                  { type: 'text-delta', id: 'answer', text: 'Recovery inspected; the conflict remains for a semantic decision.' },
                  { type: 'text-end', id: 'answer' },
                  { type: 'step-finish', index: 0, reason: 'stop' },
                  { type: 'finish', reason: 'stop', usage },
                ]
              : [
                  { type: 'step-start', index: 0 },
                  { type: 'tool-input-start', id: 'recovery', name: 'read_graph_recovery' },
                  { type: 'tool-call', id: 'recovery', name: 'read_graph_recovery', input: { branch: 'main' } },
                  { type: 'step-finish', index: 0, reason: 'tool-calls' },
                  { type: 'finish', reason: 'tool-calls', usage },
                ];
            if (said.includes('"type":"tool-result","id":"recovery"')) Deferred.doneUnsafe(inspected, Effect.succeed(said));
            return Stream.fromIterable(events);
          }),
      }) as ReturnType<ModelAccess['Service']['request']>,
  });

const setup = Effect.gen(function* () {
  const inspected = Deferred.makeUnsafe<string>();
  const world = yield* makeDoorWorld({ models: scripted(inspected) });
  yield* holdThreads(world);
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('project'));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* suiteGit(root, 'commit', '--allow-empty', '-m', 'born');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
  expect(added.status).toBe(200);
  return { world, inspected, projectId: (added.body as { project: { id: number } }).project.id };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/GraphRecovery') {}

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('graph recovery', (it) => {
  it.effect(
    'the notification action starts a project recovery thread, its graph tool reads the incident, and retry reuses the thread',
    () =>
      Effect.gen(function* () {
        const { world, projectId, inspected } = yield* Place;
        const files = yield* FileSystem.FileSystem;
        const query = `project=${projectId}`;
        const created = yield* world.op('create_block', { tags: ['idea'], title: 'Merge subject', body: 'initial knowledge' }, query);
        expect(created.status).toBe(200);
        const name = (created.body as { block: { name: string } }).block.name;
        const graph = yield* world.runtime.pool.resolve({ projectId });
        const shadow = graph.shadow;
        if (shadow === null) return yield* Effect.die(new Error('expected a shadow'));
        const id = yield* Context.get(graph.context, BlockNames).idOfName(name);
        const row = yield* Context.get(graph.context, Blocks).rawBlockById(id);
        if (row.path === null) return yield* Effect.die(new Error('missing block file'));
        yield* world.runtime.pool.releaseProject(projectId);
        const path = join(graph.layout.treeRoot, row.path);
        const original = yield* files.readFileString(path);
        yield* shadow.branch('incoming', 'main');
        const incoming = join(world.root, 'incoming-graph');
        yield* shadow.attach(incoming, 'incoming');
        yield* files.writeFileString(join(incoming, row.path), original.replace('initial knowledge', 'incoming knowledge'));
        yield* shadow.commitAct(incoming, 'incoming knowledge');
        yield* files.writeFileString(path, original.replace('initial knowledge', 'current knowledge'));
        yield* shadow.commitAct(graph.layout.treeRoot, 'current knowledge');
        const merges = TreeMerges.at(shadow, graph.layout.treeRoot);
        yield* merges.merge('incoming');
        const pending = yield* merges.read();
        if (pending === null) return yield* Effect.die(new Error('missing incident'));
        const started = yield* world.op('start_graph_recovery', { id: pending.id, branch: 'main' }, query);
        expect(started.status).toBe(200);
        expect(started.body).toMatchObject({ status: 'assigned' });
        const threadId = (started.body as { threadId: string }).threadId;
        const received = yield* Deferred.await(inspected);
        for (const value of [pending.id, pending.path, pending.base, pending.theirs]) expect(received).toContain(value);
        const retry = yield* world.op('start_graph_recovery', { id: pending.id, branch: 'main' }, query);
        expect(retry.status).toBe(200);
        expect(retry.body).toEqual(started.body);
        const snapshot = yield* world.op('read_thread_snapshot', { threadId }, query);
        expect(snapshot.status).toBe(200);
        expect(snapshot.body).toMatchObject({ snapshot: { thread: { id: threadId } } });
        expect((yield* merges.read())?.threadId).toBe(threadId);
        yield* files.writeFileString(join(pending.path, row.path), original.replace('initial knowledge', 'current and incoming knowledge'));
        const finished = yield* world.op('resolve_graph_conflict', { branch: 'main' }, query);
        expect(finished.status).toBe(200);
        expect(finished.body).toMatchObject({ status: 'ok', resolved: [row.path] });
        const notice = yield* world.op('read_graph_recovery', { branch: 'main' }, query);
        expect(notice.body).toEqual({ status: 'ok', recovery: null });
        const restored = yield* world.op('read_block', { blockIds: [name] }, query);
        expect(restored.status).toBe(200);
        expect((restored.body as { reads: readonly { body: string }[] }).reads[0]?.body.trim()).toBe('current and incoming knowledge');
      }),
  );
});
