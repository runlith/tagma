import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Context, Deferred, Effect, Layer, Stream } from 'effect';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { birthsOf, threadInbox } from '../../../threads/testing/doubles.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { makeDoorWorld } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { teamTree } from '../teamTree.js';

type Answer = { readonly status?: string; readonly code?: string; readonly [field: string]: unknown };

const RAISE = 'Raise the walls in the tree.';

const answering = (text: string): readonly LLMEvent[] => [
  { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', text },
  { type: 'text-end', id: 'reply' },
  { type: 'finish', reason: 'stop' },
];

const setup = Effect.gen(function* () {
  const gates = new Map([[RAISE, yield* Deferred.make<void>()]]);
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: (input) => ({
        ...standing.request(input),
        stream: (call) => {
          const done = Stream.fromIterable(answering('Done.'));
          const said = JSON.stringify(call.messages);
          const gate = [...gates].find(([task]) => said.includes(task))?.[1];
          return gate === undefined ? done : Stream.unwrap(Effect.as(Deferred.await(gate), done));
        },
      }),
    }),
  });
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  return { world, account, gates };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/HeldTasks') {}

const at = (projectId: number, cwd?: string) => `project=${projectId}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`;

const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown, where: string) {
  const { world } = yield* Place;
  const query = where;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/${id}?${query}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' },
        body: JSON.stringify(input),
      }),
      world.routed,
    ),
  );
  return (yield* Effect.promise(() => response.json())) as Answer;
});

const operator = Effect.fnUntraced(function* (id: string, input: unknown, where: string) {
  const { world } = yield* Place;
  return (yield* world.op(id, input, where)).body as Answer;
});

const filed = Effect.fnUntraced(function* (threadId: string, title: string, where: string) {
  const born = yield* asThread(threadId, 'create_block', { tags: ['task'], title }, where);
  return born as { readonly block: { readonly name: string }; readonly graphCopy?: { readonly branch: string | null } };
});

const standing = Effect.fnUntraced(function* (name: string, where: string) {
  const read = (yield* operator('read_block', { blockIds: [name], depth: 0 }, where)) as {
    readonly reads: readonly { readonly fields: { readonly status: string; readonly holder?: number | null } }[];
  };
  return read.reads[0]!.fields;
});

const sessionOf = Effect.fnUntraced(function* (threadId: string, where: string) {
  const listed = (yield* operator('list_sessions', {}, where)) as {
    readonly sessions: readonly { readonly id: number; readonly key: string }[];
  };
  return listed.sessions.find((session) => session.key === threadId)?.id;
});

const newest = Effect.fnUntraced(function* (name: string, where: string) {
  const read = (yield* operator('read_events', { blockId: name, limit: 1 }, where)) as {
    readonly events: readonly { readonly op: string; readonly writer: string | null }[];
  };
  return read.events[0];
});

const handedLine = Effect.fnUntraced(function* (parentId: string, childId: string) {
  const { world } = yield* Place;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  const rows = yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, parentId)).all()),
  );
  const line = rows
    .map(parseThreadInboxItem)
    .find(
      (item) =>
        item.kind === 'signal' &&
        item.body.notice?.kind === 'child-update' &&
        item.body.notice.event === 'tasks' &&
        item.body.notice.child.threadId === childId,
    );
  if (line?.kind !== 'signal') return yield* Effect.die(new Error('the settled child left no task notice'));
  return line.body;
});

layer(Layer.effect(Place, setup), {
  excludeTestServices: true,
})('held tasks', (it) => {
  it.effect('worktree task handover and release follow the graph copy after the worker or root leaves', () =>
    Effect.gen(function* () {
      const { world, account, gates } = yield* Place;
      const { projectId, checkout, destination, rootId } = yield* teamTree(world, 'walls');
      const tree = at(projectId, destination);
      const lead = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, title: 'tree lead', account }))
        .thread.id;
      const child = (yield* asThread(lead, 'spawn_agent', { agentId: 'tagma', task: RAISE, worktree: rootId }, at(projectId)))
        .threadId as string;
      const born = yield* filed(child, 'Frame the walls', tree);
      expect(born.graphCopy).toMatchObject({ branch: 'walls' });
      const task = born.block.name;
      expect(yield* asThread(child, 'claim_block', { blockId: task }, tree)).toMatchObject({ status: 'ok' });

      const settled = yield* Deferred.make<void>();
      yield* Context.get(world.runtime.owners, ThreadHarness)
        .runs.settlements()
        .subscribe({
          name: 'held-task-boundary',
          at: 'after-stages',
          handle: (run) => (run.threadId === child ? Effect.as(Deferred.succeed(settled, undefined), undefined) : Effect.void),
        });
      yield* Deferred.succeed(gates.get(RAISE)!, undefined);
      yield* Deferred.await(settled);
      const line = yield* handedLine(lead, child);

      expect(line.text).toContain(task);
      expect(yield* standing(task, tree)).toMatchObject({ status: 'in_work', holder: yield* sessionOf(lead, tree) });
      expect(yield* newest(task, tree)).toMatchObject({ op: 'claim', writer: `tagma:${lead}` });
      {
        const root = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, title: 'mover', account })).thread
          .id;
        expect(yield* operator('move_thread', { threadId: root, worktree: rootId }, at(projectId))).toMatchObject({ status: 'selected' });
        const task = (yield* filed(root, 'Hang the doors', tree)).block.name;
        expect(yield* asThread(root, 'claim_block', { blockId: task }, tree)).toMatchObject({ status: 'ok' });
        expect(yield* operator('move_thread', { threadId: root, worktree: 'main' }, at(projectId))).toMatchObject({ status: 'selected' });

        expect((yield* world.op('remove_project', { ref: String(projectId) })).status).toBe(200);
        const returned = yield* world.op('add_project', { name: world.uniqueName(), rootPath: checkout, storage: 'team' });
        expect(returned.body).toMatchObject({ project: { id: projectId } });
        expect(yield* operator('archive_thread', { threadId: root }, at(projectId))).toMatchObject({ status: 'archived' });

        expect(yield* standing(task, tree)).toMatchObject({ status: 'open' });
        expect(yield* newest(task, tree)).toMatchObject({ op: 'release', writer: `tagma:${root}` });
      }
    }),
  );
});
