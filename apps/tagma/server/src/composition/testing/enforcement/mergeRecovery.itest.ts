import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Exit, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { commitEffect, composed, refusal, shEffect } from '../finishingFixture.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('merge recovery', (it) => {
  it.effect('a merge cut after it published finishes its own request at the next recovery: checkout, deletion and receipt, once', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { finishing, make, project, projectId, seen, records, units } = yield* composed(
          demo,
          makeMachineWorld(() => null),
          { cutAfterPublishing: true },
        );
        const side = yield* make('cut');
        yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
        const cut = yield* shEffect(project, ['rev-parse', 'HEAD']);
        expect(Exit.hasDies(yield* Effect.exit(finishing.merge(projectId, side.rootId, { after: 'delete' })))).toBe(true);
        const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
        expect(head).not.toBe(cut);
        expect(existsSync(join(project, 'feature.txt'))).toBe(false);
        expect(seen.merged).toEqual([]);
        writeFileSync(join(project, 'peer.txt'), 'peer\n');
        const recovered = yield* finishing.recover();
        expect(recovered).toMatchObject({
          published: [{ path: project, commit: head, unsynced: [], reason: null }],
          uncertain: [],
          unread: [],
        });
        expect(readFileSync(join(project, 'feature.txt'), 'utf8')).toBe('feature\n');
        expect(yield* shEffect(project, ['status', '--porcelain'])).toBe('?? peer.txt');
        expect(seen.merged).toEqual([[side.rootId, 'merge', head]]);
        expect(yield* units.read((unit) => records.byRoot(side.rootId, unit))).toBeNull();
        expect(existsSync(side.path)).toBe(false);
        expect(yield* finishing.recover()).toMatchObject({ published: [], uncertain: [], unread: [] });
      }),
    ),
  );

  it.effect(
    'a rebase cut after its base moved finishes its own request: the source branch moves by its recorded commit, and an unreadable recipient lookup keeps the request open and blocks a new merge',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const {
            finishing,
            make,
            project,
            projectId,
            lookup,
            seen: record,
          } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            { cutAfterPublishing: true },
          );
          const side = yield* make('rebased');
          yield* commitEffect(side.path, 'feature.txt', 'feature\n', 'the work of the worktree');
          const source = yield* shEffect(side.path, ['rev-parse', 'HEAD']);
          expect(Exit.hasDies(yield* Effect.exit(finishing.merge(projectId, side.rootId, { mode: 'rebase' })))).toBe(true);
          const head = yield* shEffect(project, ['rev-parse', 'HEAD']);
          expect(yield* shEffect(project, ['rev-parse', side.branch])).toBe(source);
          lookup.undelivered = 'the journal of enforcement is unwritable';
          expect((yield* finishing.recover()).unread).toHaveLength(1);
          expect(record.merged).toEqual([]);
          expect(record.landed).toEqual([]);
          lookup.undelivered = null;
          lookup.fails = true;
          const held = yield* finishing.recover();
          expect(held.published).toHaveLength(1);
          expect(held.unread).toHaveLength(1);
          expect(record.merged).toEqual([]);
          expect(yield* shEffect(project, ['rev-parse', side.branch])).toBe(head);
          expect(yield* refusal(finishing.merge(projectId, side.rootId, { mode: 'rebase' }))).toBe('finishing-busy');
          lookup.fails = false;
          expect(yield* finishing.recover()).toMatchObject({ published: [{ commit: head }], unread: [] });
          expect(record.merged).toEqual([[side.rootId, 'rebase', head]]);
          expect(record.landed).toMatchObject([{ commit: head }]);
          expect(yield* shEffect(side.path, ['rev-parse', 'HEAD'])).toBe(head);
          expect(yield* finishing.recover()).toMatchObject({ published: [], uncertain: [], unread: [] });
        }),
      ),
  );
});
