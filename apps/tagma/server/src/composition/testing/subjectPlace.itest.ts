import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { DoorFixture, doorFixture } from './doorFixture.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../platform/testing/grants.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';

type Answer = { readonly status: number; readonly body: unknown };
const nameOf = (answer: Answer) => (answer.body as { block: { name: string } }).block.name;

layer(doorFixture(), { excludeTestServices: true, testTimeout: 60_000, timeout: 60_000 })('subject placement through the door', (it) => {
  it.effect('a block and a cursor select their own project over the caller home, while an explicit conflicting project refuses', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const home = yield* world.plainProject();
      const target = yield* world.plainProject();
      const operator = (id: string, input: unknown, project: number) => world.op(id, input, `project=${project}`);
      const created = yield* operator('create_thread', { approvalMode: 'bypass' }, home);
      expect(created.status).toBe(200);
      const caller = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const grant = grantEnvironment(caller, testSessionIdentity)[GRANT_VARIABLE] as string;
      const raw = (id: string, input: unknown, query = '') => world.op(id, input, query, { [GRANT_HEADER]: grant });
      const first = nameOf(yield* operator('create_block', { tags: ['idea'], title: 'First subject' }, target));
      const second = nameOf(yield* operator('create_block', { tags: ['idea'], title: 'Second subject' }, target));

      expect(yield* raw('update_block', { blockId: first, title: 'Changed in target' })).toMatchObject({
        status: 409,
        body: { code: 'instructions-unread' },
      });
      expect(yield* raw('update_block', { blockId: first, title: 'Changed in target' })).toMatchObject({ status: 200 });
      expect(yield* raw('update_block', { blockId: first, title: 'Wrong project' }, `project=${home}`)).toMatchObject({
        status: 409,
        body: { code: 'place-mismatch' },
      });
      expect(yield* operator('read_block', { blockIds: [first] }, target)).toMatchObject({
        status: 200,
        body: { reads: [{ name: first, projectId: target, title: 'Changed in target' }] },
      });

      const page = yield* operator('query_blocks', { tags: ['idea'], sort: { by: 'created', order: 'asc' }, limit: 1 }, target);
      expect(page).toMatchObject({ status: 200, body: { blocks: [{ name: first }], total: 2 } });
      const cursor = (page.body as { next: string }).next;
      expect(yield* raw('query_blocks', { cursor }, `project=${home}`)).toMatchObject({
        status: 409,
        body: { code: 'place-mismatch' },
      });
      expect(yield* raw('query_blocks', { cursor })).toMatchObject({
        status: 200,
        body: { blocks: [{ name: second }], total: 2, next: null },
      });
    }),
  );
});
