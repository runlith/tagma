import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { event, meta } from '../../../../graph/store/tables.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { servingLayer, withServing } from './fixture.js';

layer(servingLayer, { excludeTestServices: true })('machine journal', (it) => {
  it.effect('an act persists its journal outside the tree, and a tree refill preserves every entry', () =>
    withServing(({ served, projectId }) =>
      Effect.gen(function* () {
        const db = (yield* GraphStore).db;
        const root = yield* (yield* Blocks).rootBlockOf(projectId);
        const made = yield* signedBy({ harness: 'claude-code', key: 'machine-key' })(
          (yield* Blocks).create({ projectId, parentId: root.id, tags: ['idea'], title: 'Machine Truth', body: 'an act to remember' }),
        );
        expect(yield* db.select().from(event).where(eq(event.blockId, made.id))).toContainEqual(
          expect.objectContaining({ op: 'create', blockId: made.id }),
        );
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.exists(join(served.layout.treeRoot, '.journal'))).toBe(false);
        const before = yield* db.select().from(event).orderBy(event.id);
        yield* db.delete(meta).where(eq(meta.key, 'tree-head'));
        yield* served.settled(true);
        expect(yield* db.select().from(event).orderBy(event.id)).toEqual(before);
      }),
    ),
  );
});
