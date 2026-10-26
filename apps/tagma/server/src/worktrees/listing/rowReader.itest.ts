import { RequestKey } from '../../platform/contract/wire/ids.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { demoGraphLayer, gitEffect, tempRepoEffect, tempRootEffect, withDemo } from '../../composition/testing/graphFixture.js';
import type { WorktreeFeedEvent, WorktreeRow } from '../contract/wire/rows.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { listingRig } from '../../composition/testing/listingRig.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('worktree listing', (it) => {
  it.effect('a non-repository has no branch, while unread checkout facts keep the branch known from metadata', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const rig = listingRig(demo);
        const git = yield* Git;
        const files = yield* FileSystem.FileSystem;
        const broken = yield* tempRepoEffect(demo.fixture, 'refused-');
        const refusing: Git['Service'] = {
          run: (args, options) =>
            args.includes('status') && (args[args.indexOf('-C') + 1] ?? options?.cwd) === broken
              ? Effect.succeed({ status: 128, stdout: '', stderr: 'fatal: index file corrupt', overflow: false, messageOverflow: false })
              : git.run(args, options),
        };
        const { listing } = yield* rig.composing(refusing);
        const plain = yield* files.realPath(yield* tempRootEffect(demo.fixture, 'plain-'));
        const plainId = (yield* demo.graph.projectLifecycle.create({ name: 'plain', rootPath: plain })).id;
        const brokenId = (yield* demo.graph.projectLifecycle.create({ name: 'refused', rootPath: broken })).id;
        const mainOf = (projectId: number) =>
          Effect.map(listing.list(projectId, { limit: 1 }), (listed) =>
            listed.rows.map((row) => [row.branch, row.reading, row.status, row.uncommitted]),
          );
        expect(yield* mainOf(plainId)).toEqual([[null, 'no-repository', 'idle', null]]);
        expect(yield* mainOf(brokenId)).toEqual([[yield* rig.branchOf(broken), 'failed', 'unread', null]]);
      }),
    ),
  );

  it.effect('metadata includes detached checkouts and commit time, and reopening a stationary window reuses its facts and indices', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const rig = listingRig(demo);
        const git = yield* Git;
        const statuses = new Map<string, number>();
        const counted: Git['Service'] = {
          run: (args, options) =>
            Effect.suspend(() => {
              if (args.includes('status')) {
                const dir = args[args.indexOf('-C') + 1] ?? options?.cwd ?? '';
                statuses.set(dir, (statuses.get(dir) ?? 0) + 1);
              }
              return git.run(args, options);
            }),
        };
        const { listing, placed } = yield* rig.composing(counted);
        const checkout = yield* tempRepoEffect(demo.fixture, 'feed-');
        yield* gitEffect(checkout, ['worktree', 'add', '-q', '--detach', `${checkout}-other`]);
        yield* gitEffect(checkout, ['commit', '-q', '--allow-empty', '-m', 'main advances']);
        const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'feed', rootPath: checkout })).id;
        const committed =
          Number((yield* spawnedEffect(['git', 'log', '-1', '--format=%at'], { cwd: checkout })).stdout.toString().trim()) * 1000;
        const open = Effect.scoped(
          Effect.gen(function* () {
            const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
            yield* Effect.forkScoped(
              Stream.runForEach(listing.subscribe(projectId, { start: 0, limit: 2 }), (event) => Queue.offer(frames, event)),
            );
            let rows: readonly WorktreeRow[] = [];
            yield* rig.next(frames, (event) => {
              if (event.kind === 'list') rows = event.rows;
              else if (event.kind === 'row') rows = rows.map((row) => (row.rootId === event.row.rootId ? event.row : row));
              return rows.length === 2 && rows.every((row) => row.reading !== 'pending');
            });
            return rows;
          }),
        );
        const opened = yield* open;
        const reads = new Map(statuses);
        const reopened = yield* open;
        expect(opened.map((row) => [row.kind, row.index, row.branch === null])).toEqual([
          ['main', 0, false],
          ['external', 1, true],
        ]);
        expect(opened[0]?.movedAt).toBe(new Date(committed).toISOString());
        expect(reopened).toEqual(opened);
        expect(statuses).toEqual(reads);
        yield* gitEffect(checkout, ['checkout', '-q', '--detach', 'HEAD']);
        const detached = yield* Stream.runHead(listing.subscribe(projectId, { start: 0, limit: 1 }));
        expect(detached._tag === 'Some' && detached.value.kind === 'list' ? detached.value.rows[0]?.branch : 'no-frame').toBeNull();
        const later = new Date(committed + 3_600_000);
        placed.push({ threadId: 'main', movedAt: later, rootId: null, cleared: false, state: 'idle' });
        expect((yield* listing.list(projectId, { limit: 1 })).rows[0]?.movedAt).toBe(later.toISOString());
      }),
    ),
  );

  it.effect(
    'a base-only movement keeps the old witness, an index change refreshes state, and explicit merge checking recognizes a squash',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const rig = listingRig(demo);
          const { acquired, repositories, worktrees, listing, checks, paths } = yield* rig.composed;
          const checkout = yield* tempRepoEffect(demo.fixture, 'base-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'base', rootPath: checkout })).id;
          yield* listing.list(projectId, { limit: 1 });
          const store = yield* repositories.register({ path: checkout, projectId });
          const trunk = yield* rig.branchOf(checkout);
          const operationId = RequestKey.make('base');
          yield* worktrees.prepare({
            intent: {
              operationId,
              projectId,
              repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
              destination: paths.join(paths.dirname(checkout), `${paths.basename(checkout)}-side`),
              mode: { kind: 'new-branch', branch: 'tagma/side', start: trunk },
            },
            acquired,
          });
          const side = yield* worktrees.execute({ operationId, projectId, acquired });
          const rowOf = () =>
            Effect.map(listing.list(projectId, { limit: 2 }), (listed) => listed.rows.find((row) => row.rootId === side.rootId));
          const original = yield* rowOf();
          writeFileSync(paths.join(checkout, 'base.txt'), 'base moves\n');
          yield* gitEffect(checkout, ['add', 'base.txt']);
          yield* gitEffect(checkout, ['commit', '-q', '-m', 'base moves']);
          const previous = yield* rowOf();
          expect([previous?.stateFact.state, previous?.stateFact.base]).toEqual(['previous', original?.stateFact.base]);
          writeFileSync(paths.join(side.destination, 'feature.txt'), 'feature\n');
          yield* gitEffect(side.destination, ['add', 'feature.txt']);
          expect((yield* rowOf())?.uncommitted).toBe(1);
          yield* gitEffect(side.destination, ['commit', '-q', '-m', 'feature']);
          expect((yield* rowOf())?.status).toBe('ready');
          writeFileSync(paths.join(checkout, 'feature.txt'), 'feature\n');
          yield* gitEffect(checkout, ['add', 'feature.txt']);
          yield* gitEffect(checkout, ['commit', '-q', '-m', 'feature squashed']);
          yield* checks.check(side.destination, yield* rig.headOf(checkout), yield* rig.headOf(side.destination));
          expect((yield* rowOf())?.status).toBe('merged');
        }),
      ),
  );
});
