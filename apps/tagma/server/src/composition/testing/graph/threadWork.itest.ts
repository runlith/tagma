import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Stream } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import type { ThreadWork } from '../../../graph/contract/wire/threadWork.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';
import { teamTree } from '../teamTree.js';
import { suiteGit } from '../suiteGit.js';

type Answer = {
  readonly status?: string;
  readonly code?: string;
  readonly block?: { readonly name: string };
  readonly snapshot?: { readonly thread: { readonly id: string } };
};

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (selection) => ({
      ...standing.request(selection),
      stream: () =>
        Stream.fromIterable([
          { type: 'text-start', id: 'reply' },
          { type: 'text-delta', id: 'reply', text: 'Done.' },
          { type: 'text-end', id: 'reply' },
          { type: 'finish', reason: 'stop' },
        ]),
    }),
  }),
});

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  yield* nativeLeads(world, yield* subscriptionLogin(world));
  const home = yield* world.stealthProject();
  const other = yield* world.stealthProject();
  yield* projectLeaving(world, home, other);
  yield* holdThreads(world);
  return { world, home, other };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ThreadWork') {}

const at = (projectId: number, cwd?: string) => `project=${projectId}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`;

const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown, projectId: number, cwd?: string) {
  const { world } = yield* Place;
  const send = Effect.promise(async (signal) => {
    const response = await world.app(
      new Request(`http://tagma/api/op/${id}?${at(projectId, cwd)}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' },
        body: JSON.stringify(input),
      }),
      world.routed,
    );
    return (await response.json()) as Answer;
  });
  const first = yield* send;
  return first.code === 'instructions-unread' ? yield* send : first;
});

const operator = Effect.fnUntraced(function* (id: string, input: unknown, projectId: number, cwd?: string) {
  const { world } = yield* Place;
  return (yield* world.op(id, input, at(projectId, cwd))).body as Answer;
});

const workOf = (threadId: string, projectId: number, page: { readonly limit?: number; readonly cursor?: string | null } = {}) =>
  Effect.map(
    operator('read_thread_work', { threadId, limit: page.limit, cursor: page.cursor ?? undefined }, projectId),
    (answer) => answer as Answer & ThreadWork,
  );

const named = (answer: Answer) => answer.block?.name ?? '';

const rootOf = Effect.fnUntraced(function* (projectId: number) {
  const { world } = yield* Place;
  const root = yield* Context.get(world.runtime.graph, Blocks).rootBlockOf(projectId).pipe(Effect.provide(world.runtime.graph));
  return blockName(root.uuid);
});

const worker = Effect.fnUntraced(function* (title: string) {
  const { world, home } = yield* Place;
  return (yield* birthsOf(world.runtime.owners).create({ projectId: home, createdBySessionId: null, title, approvalMode: 'bypass' })).thread
    .id;
});

layer(Layer.effect(Place, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('thread work in the graph', (it) => {
  it.effect('a thread reads the work it holds under its spec and its acts in two copies, then the work it finished with its commit', () =>
    Effect.gen(function* () {
      const { home, other } = yield* Place;
      const thread = yield* worker('worker');
      const homeRoot = yield* rootOf(home);
      const spec = named(yield* operator('create_block', { tags: ['spec'], title: 'Walls stand', parentId: homeRoot }, home));
      const task = named(yield* operator('create_block', { tags: ['task'], title: 'Raise the walls', parentId: spec }, home));
      const elsewhere = named(yield* operator('create_block', { title: 'Mortar notes', parentId: yield* rootOf(other) }, other));
      expect(yield* asThread(thread, 'claim_block', { blockId: task }, home)).toMatchObject({ status: 'ok' });
      const note = named(yield* asThread(thread, 'create_block', { title: 'Brick sizes', parentId: homeRoot }, home));
      expect(yield* asThread(thread, 'update_block', { blockId: elsewhere, title: 'Mortar mix' }, other)).toMatchObject({ status: 'ok' });

      const read = yield* workOf(thread, home, { limit: 1 });
      expect(read.copies.map((copy) => copy.projectId).sort()).toEqual([home, other].sort());
      expect(read.works).toMatchObject([{ name: task, title: 'Raise the walls', spec: { name: spec, title: 'Walls stand' } }]);
      expect(read.total).toBe(2);
      expect(read.did).toMatchObject([{ name: elsewhere, acts: ['edited'], last: 'edited' }]);
      expect(read.copies[read.did[0]!.copy]?.projectId).toBe(other);
      const rest = yield* workOf(thread, home, { cursor: read.next });
      expect(rest.did.map((row) => [row.name, row.last])).toEqual([[note, 'created']]);
      expect(rest.next).toBeNull();
      expect(yield* workOf(yield* worker('stranger'), home, { cursor: read.next })).toMatchObject({ code: 'cursor-stale' });

      expect(yield* asThread(thread, 'finish_block', { blockId: task, commit: 'c0ffee1234' }, home)).toMatchObject({ status: 'ok' });
      const after = yield* workOf(thread, home);
      expect(after.works).toEqual([]);
      expect(after.total).toBe(3);
      expect(after.did[0]).toMatchObject({ name: task, acts: ['finished'], last: 'finished', commit: 'c0ffee1234' });
    }),
  );

  it.effect('a thread reads its acts in every copy of a foreign project it worked in, not only the last', () =>
    Effect.gen(function* () {
      const { world, home } = yield* Place;
      const { projectId, checkout, destination } = yield* teamTree(world, 'mortar');
      const thread = yield* worker('two copies');
      const mortarRoot = yield* rootOf(projectId);
      const before = named(yield* operator('create_block', { title: 'Lime ratio', parentId: mortarRoot }, projectId));
      const after = named(yield* operator('create_block', { title: 'Sand grade', parentId: mortarRoot }, projectId, destination));
      expect(yield* asThread(thread, 'update_block', { blockId: before, title: 'Lime ratio, wet' }, projectId)).toMatchObject({
        status: 'ok',
      });
      expect(yield* asThread(thread, 'update_block', { blockId: after, title: 'Sand grade, fine' }, projectId, destination)).toMatchObject({
        status: 'ok',
      });

      const read = yield* workOf(thread, home);
      expect(read.unread).toEqual([]);
      expect(read.did.map((row) => [row.name, read.copies[row.copy]?.projectId, read.copies[row.copy]?.branch])).toEqual([
        [after, projectId, 'mortar'],
        [before, projectId, null],
      ]);

      const local = (yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        title: 'team worker',
        approvalMode: 'bypass',
      })).thread.id;
      expect(yield* asThread(local, 'update_block', { blockId: after, title: 'Sand grade, coarse' }, projectId, destination)).toMatchObject(
        {
          status: 'ok',
        },
      );
      const own = yield* workOf(local, projectId);
      expect(own.did.map((row) => [row.name, own.copies[row.copy]?.branch])).toEqual([[after, 'mortar']]);

      yield* suiteGit(checkout, 'worktree', 'remove', '--force', destination);
      const left = yield* workOf(thread, home);
      expect(left.unread).toEqual([]);
      expect(left.did.map((row) => row.name)).toEqual([before]);
    }),
  );

  it.effect('a thread born on work another thread holds takes it over in its own name within the birth', () =>
    Effect.gen(function* () {
      const { home } = yield* Place;
      const first = yield* worker('first hand');
      const homeRoot = yield* rootOf(home);
      const task = named(yield* operator('create_block', { tags: ['task'], title: 'Lay the floor', parentId: homeRoot }, home));
      expect(yield* asThread(first, 'claim_block', { blockId: task }, home)).toMatchObject({ status: 'ok' });

      const born = yield* operator('create_thread', { title: 'Lay the floor', work: task }, home);
      expect(born.status).toBe('loaded');
      const taker = born.snapshot!.thread.id;
      expect((yield* workOf(taker, home)).works).toMatchObject([{ name: task, status: 'in_work' }]);
      expect((yield* workOf(first, home)).works).toEqual([]);

      expect(yield* operator('create_thread', { work: task, task: 'Also this' }, home)).toMatchObject({ code: 'work-with-task' });
      expect(
        yield* operator(
          'create_thread',
          { work: named(yield* operator('create_block', { title: 'A note', parentId: homeRoot }, home)) },
          home,
        ),
      ).toMatchObject({
        code: 'no-holder',
      });
      const spec = named(yield* operator('create_block', { tags: ['spec'], title: 'Floors stand', parentId: homeRoot }, home));
      expect(yield* operator('create_thread', { work: spec }, home)).toMatchObject({ status: 'loaded' });
    }),
  );
});
