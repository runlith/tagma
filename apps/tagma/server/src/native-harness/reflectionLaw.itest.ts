import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { Message } from '@runlith/llm/schema/messages';
import { Context, Effect } from 'effect';
import { DoorFixture, doorFixture, projectLeaving } from '../composition/testing/doorFixture.js';
import { fixtureNativeCatalog } from '../composition/testing/nativeCatalog.js';
import { callerInThread } from '../composition/testing/callers.js';
import { ENTRY_KINDS } from '../composition/testing/composed.js';
import { suiteGit } from '../composition/testing/suiteGit.js';
import { CurrentGraph } from '../graph/contract/service/serving.js';
import { Orientation } from '../graph/contract/service/orientation.js';
import { Tags } from '../graph/contract/service/vocabulary.js';
import { instructionText } from '../graph/orientation/Instructions.js';
import { routedSeams } from '../graph/testing/doubles.js';
import { Projects } from '../projects/contract/service/registry.js';
import { testSessionIdentity } from '../platform/testing/identity.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { nativeThreadRows, threadStore } from './testing/doubles.js';
import { informedPlaces, instructionsTold } from './turns/instructions.js';

layer(doorFixture(), { excludeTestServices: true })('reflection law admission', (it) => {
  it.effect('a foreign native thread files friction on its first call after receiving a group-law change only in its home set', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      yield* suiteGit(world.sourceCheckout, 'init', '-q', '-b', 'main');
      yield* suiteGit(world.sourceCheckout, 'commit', '--allow-empty', '-qm', 'seed');
      const sourceAdded = yield* world.op('add_project', {
        name: 'source',
        rootPath: world.sourceCheckout,
        storage: 'team',
      });
      expect(sourceAdded.status).toBe(200);
      const source = (sourceAdded.body as { project: { id: number } }).project.id;
      expect((yield* world.op('write_setting', { project: source, key: 'graph.commit', value: 'manual' })).status).toBe(200);
      const home = yield* world.stealthProject();
      yield* projectLeaving(world, source, home);
      const group = yield* world.op('make_group', { name: world.uniqueName(), projects: [String(source), String(home)] });
      expect(group.status).toBe(200);
      const groupId = (group.body as { group: { graph: { id: number } } }).group.graph.id;
      const at = (project: number) => `project=${project}`;
      const roots = yield* world.op('list_root_blocks', {}, at(groupId));
      const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
      const made = yield* world.op('create_block', { parentId, tags: ['rule'], title: 'The shared norm' }, at(groupId));
      expect(made.status).toBe(200);
      const rule = (made.body as { block: { name: string } }).block.name;
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, at(home));
      expect(born.status).toBe(200);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const sourceGraph = yield* world.runtime.pool.resolve({ projectId: source });
      const homeGraph = yield* world.runtime.pool.resolve({ projectId: home });
      const instructions = (projectId: number, graph: typeof homeGraph) =>
        Context.get(graph.context, Orientation).instructions({ projectId, audience: 'graph' }).pipe(Effect.provide(graph.context));
      const originalSource = yield* instructions(source, sourceGraph);
      const originalHome = yield* instructions(home, homeGraph);
      const records = Context.get(world.runtime.owners, ThreadRecords);
      const store = yield* threadStore(records, ENTRY_KINDS).pipe(Effect.provide(world.runtime.owners));
      const rows = yield* nativeThreadRows(store, records).pipe(Effect.provide(world.runtime.owners));
      yield* store.appendEntries(thread.id, {
        history: [
          agentRuntimeGuidanceMessage(`${instructionText(originalHome)}\n\n${instructionText(originalSource)}`, {
            [instructionsTold(home)]: originalHome,
            [instructionsTold(source)]: originalSource,
          }),
        ],
      });
      expect((yield* world.op('update_block', { blockId: rule, title: 'The changed shared norm' }, at(groupId))).status).toBe(200);
      const changedHome = yield* instructions(home, homeGraph);
      const shared = changedHome.entries.find((entry) => entry.kind === 'law' && entry.source === rule)!;
      expect(originalSource.entries.find((entry) => entry.kind === 'law' && entry.source === rule)?.revision).not.toBe(shared.revision);
      const input = { title: 'Foreign friction', command: 'read_block', expected: 'the requested block', actual: 'a wrong block' };
      const callId = 'file-foreign-friction';
      yield* store.appendEntries(thread.id, {
        history: [
          agentRuntimeGuidanceMessage(instructionText(changedHome, originalHome), { [instructionsTold(home)]: changedHome }),
          Message.assistant([{ type: 'tool-call', id: callId, name: 'file_reflection', input }]),
        ],
      });
      const vocabulary = yield* Context.get(homeGraph.context, Tags).of(home);
      const tools = yield* fixtureNativeCatalog(
        {
          caller: {
            actor: {
              kind: 'thread',
              threadId: thread.id,
              projectId: home,
              principalId: thread.ownerId,
              session: { harness: 'tagma', key: thread.id },
            },
            files: world.runtime.scratch.scope(thread.id),
          },
          place: { root: homeGraph.checkout, origin: null },
          world: 'checkout',
          project: { id: home, name: (yield* Context.get(world.runtime.owners, Projects).byId(home)).name },
          vocabulary: () => vocabulary,
          identity: testSessionIdentity,
          graphRoot: homeGraph.checkout,
          served: homeGraph,
          places: informedPlaces(Context.get(world.runtime.owners, WorkPlaces), rows),
          owners: Context.merge(
            Context.merge(world.runtime.owners, homeGraph.context),
            routedSeams(homeGraph.context, world.runtime.pool),
          ).pipe(Context.add(CurrentGraph, homeGraph)),
        },
        ['file_reflection', 'create_block'],
      );
      const tool = tools.file_reflection!;
      const call = { toolCallId: callId, caller: callerInThread(thread.id, 'filing-run') };
      const prepared = yield* toolPrepare(tool)!(input, call);
      const answer = yield* toolExecute(tool)!(input, { ...call, prepared: prepared.prepared, messages: [] });
      const filed = (answer instanceof ToolAnswer ? answer.value : answer) as { status: string; block: { name: string } };
      if (filed.status !== 'ok') return yield* Effect.die(JSON.stringify(filed));
      expect(yield* world.op('read_block', { blockIds: [filed.block.name] }, at(source))).toMatchObject({
        status: 200,
        body: {
          reads: [{ projectId: source, stealth: true, fields: { command: input.command, expected: input.expected, actual: input.actual } }],
        },
      });
      expect(yield* Context.get(world.runtime.owners, WorkPlaces).held(thread.id)).toEqual([]);
      const sourceRoots = yield* world.op('list_root_blocks', {}, at(source));
      const sourceRoot = (sourceRoots.body as { blocks: { name: string }[] }).blocks[0]!.name;
      expect(
        yield* Effect.result(
          toolPrepare(tools.create_block!)!(
            { parentId: `${source}/${sourceRoot}`, title: 'Ordinary foreign work' },
            { ...call, toolCallId: 'create-foreign-note' },
          ),
        ),
      ).toMatchObject({ _tag: 'Failure', failure: { code: 'instructions-unread' } });
    }).pipe(Effect.provide(BunFileSystem.layer)),
  );
});
