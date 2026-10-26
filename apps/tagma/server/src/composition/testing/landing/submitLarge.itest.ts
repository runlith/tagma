import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { contentDigest } from '@runlith/files/content';
import {
  workspaceChange,
  workspaceChangeText,
  workspaceChangeContent,
  changeLogWrites,
  held,
} from '../../../change-record/store/tables.js';
import { TEST_CHECKOUT } from '../../../workspace/testing/doubles.js';
import { MINE, checkoutFixture, withCheckout } from '../checkoutFixture.js';

layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('submit_work lands large recorded files and retires unchanged steps', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        const head = yield* world.run(['rev-parse', 'HEAD']);
        const empty = contentDigest('');
        const directory = 'capture/records';
        mkdirSync(join(world.root, directory), { recursive: true });
        const paths = [`${directory}/0.json`, `${directory}/1.json`];
        yield* world.units
          .write(changeLogWrites, (unit) =>
            unit.run(world.store.db.insert(workspaceChangeContent).values({ digest: empty, text: '', bytes: 0 }).onConflictDoNothing()),
          )
          .pipe(Effect.provide(world.context));
        for (const [at, path] of paths.entries()) {
          const text = `{"id":${at},"text":"${'x'.repeat(at === 0 ? 6_400_000 : 1_600_000)}"}\n`;
          writeFileSync(join(world.root, path), text);
          const digest = contentDigest(text);
          yield* world.units
            .write(changeLogWrites, (unit) =>
              Effect.gen(function* () {
                yield* unit.run(world.store.db.insert(workspaceChangeContent).values({ digest, text, bytes: text.length }));
                yield* unit.run(
                  world.store.db.insert(workspaceChange).values({
                    id: `held-${at}`,
                    projectId: world.projectId,
                    holderProjectId: world.projectId,
                    holder: MINE,
                    checkout: TEST_CHECKOUT,
                    path,
                    head,
                    state: 'held',
                    origin: 'write',
                    mode: '100644',
                    beforeHash: empty,
                    afterHash: digest,
                    firstLine: 1,
                    lines: 1,
                    oldLines: 0,
                    windowBefore: 0,
                    at: new Date(at),
                  }),
                );
                yield* unit.run(world.store.db.insert(workspaceChangeText).values({ row: `held-${at}`, oldText: '', newText: text }));
                if (at === 0)
                  yield* unit.run(
                    world.store.db.insert(workspaceChange).values({
                      id: 'unchanged',
                      projectId: world.projectId,
                      holderProjectId: world.projectId,
                      holder: MINE,
                      checkout: TEST_CHECKOUT,
                      path,
                      head,
                      state: 'held',
                      origin: 'edit',
                      mode: '100644',
                      beforeHash: digest,
                      afterHash: digest,
                      at: new Date(paths.length),
                    }),
                  );
              }),
            )
            .pipe(Effect.provide(world.context));
        }
        const receipt = yield* world.submit(MINE, { subject: 'Submit large recorded files' });
        expect(receipt).toMatchObject({ status: 'landed', committed: paths });
        for (const path of paths) {
          expect(yield* world.run(['rev-parse', `HEAD:${path}`])).toBe(yield* world.run(['hash-object', '--', path]));
        }
        const standing = yield* world.store.db
          .select({ id: workspaceChange.id })
          .from(workspaceChange)
          .where(and(eq(workspaceChange.checkout, TEST_CHECKOUT), eq(workspaceChange.holder, MINE), held));
        expect(standing).toEqual([]);
      }),
    ),
  );
});
