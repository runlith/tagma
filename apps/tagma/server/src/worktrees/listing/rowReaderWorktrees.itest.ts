import { RequestKey } from '../../platform/contract/wire/ids.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { rmSync, writeFileSync } from 'node:fs';
import { Clock, Deferred, Effect, FileSystem, Layer, Path, Queue, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { Git } from '@runlith/git/Git';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { demoGraphLayer, gitEffect, tempRepoEffect, withDemo } from '../../composition/testing/graphFixture.js';

import type { WorktreeFeedEvent, WorktreeRow } from '../contract/wire/rows.js';
import { listingRig } from '../../composition/testing/listingRig.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('listed worktrees', (it) => {
  it.effect('a worktree with an act in flight keeps the row it showed until the act ends, while other rows move', () =>
    withDemo((demo) => {
      const rig = listingRig(demo);
      return Effect.gen(function* () {
        const { acquired, repositories, worktrees, listing, placed, moved, paths, progress } = yield* rig.composed;
        const checkout = yield* tempRepoEffect(demo.fixture, 'frozen-');
        const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'frozen', rootPath: checkout })).id;
        yield* listing.list(projectId, {});
        const store = yield* repositories.register({ path: checkout, projectId });
        const operationId = RequestKey.make('frozen');
        yield* worktrees.prepare({
          intent: {
            operationId,
            projectId,
            repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
            destination: paths.join(paths.dirname(checkout), `${paths.basename(checkout)}-side`),
            mode: { kind: 'new-branch', branch: 'tagma/side', start: yield* rig.branchOf(checkout) },
          },
          acquired,
        });
        const side = yield* worktrees.execute({ operationId, projectId, acquired });
        const sideRoot = side.rootId;
        if (sideRoot === null) return yield* Effect.die('the creation registered no root');
        const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
        yield* Effect.forkScoped(
          Stream.runForEach(listing.subscribe(projectId, { start: 0, limit: 3 }), (event) => Queue.offer(frames, event)),
        );
        let shown: readonly WorktreeRow[] = [];
        yield* rig.next(frames, (event) => {
          if (event.kind === 'list') shown = event.rows;
          else if (event.kind === 'row') shown = shown.map((row) => (row.rootId === event.row.rootId ? event.row : row));
          return shown.length === 2 && shown.every((row) => row.reading !== 'pending');
        });
        const rowsOf = (event: WorktreeFeedEvent): readonly WorktreeRow[] =>
          event.kind === 'row' ? [event.row] : event.kind === 'list' ? event.rows : [];
        const sideOf = (event: WorktreeFeedEvent) => rowsOf(event).find((row) => row.rootId === sideRoot);
        const mainOf = (event: WorktreeFeedEvent) => rowsOf(event).find((row) => row.kind === 'main');

        const release = yield* Deferred.make<void>();
        const started = yield* Deferred.make<void>();
        yield* Effect.forkScoped(
          progress.during(projectId, sideRoot, 'merge', Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(release))),
        );
        yield* Deferred.await(started);
        writeFileSync(paths.join(side.destination, 'HALF.md'), 'half removed\n');
        placed.push({
          threadId: 'in-main',
          movedAt: new Date(yield* Clock.currentTimeMillis),
          rootId: null,
          cleared: false,
          state: 'working',
        });
        moved();
        const during: WorktreeFeedEvent[] = [];
        yield* rig.next(frames, (event) => {
          during.push(event);
          return mainOf(event)?.agents.working === 1;
        });
        expect(during.flatMap((event) => sideOf(event)?.uncommitted ?? [])).not.toContain(1);

        yield* Deferred.succeed(release, undefined);
        const after = yield* rig.next(frames, (event) => sideOf(event)?.uncommitted === 1);
        expect(sideOf(after)?.uncommitted).toBe(1);
      });
    }),
  );

  it.effect(
    'a created worktree lists idle with its hue and base, turns working when an agent runs there, missing when its folder goes, and leaves the feed once its record is dropped',
    () =>
      withDemo((demo) => {
        const rig = listingRig(demo);
        return Effect.gen(function* () {
          const { acquired, repositories, worktrees, listing, checkouts, placed, moved, recordMoved, paths, units, operations } =
            yield* rig.composed;
          const checkout = yield* tempRepoEffect(demo.fixture, 'cut-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'cut', rootPath: checkout })).id;
          expect((yield* listing.list(projectId, { limit: 1 })).rows.map((row) => row.kind)).toEqual(['main']);
          const external = paths.join(paths.dirname(checkout), `${paths.basename(checkout)}-outside`);
          yield* gitEffect(checkout, ['worktree', 'add', '-q', '--detach', external]);
          expect((yield* listing.list(projectId, { limit: 2 })).rows.map((row): string => row.kind).sort()).toEqual(['external', 'main']);
          const store = yield* repositories.register({ path: checkout, projectId });
          const trunk = yield* rig.branchOf(checkout);
          const make = Effect.fnUntraced(function* (name: string) {
            const operationId = RequestKey.make(name);
            yield* worktrees.prepare({
              intent: {
                operationId,
                projectId,
                repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
                destination: paths.join(paths.dirname(checkout), `${paths.basename(checkout)}-${name}`),
                mode: { kind: 'new-branch', branch: `tagma/${name}`, start: trunk },
              },
              acquired,
            });
            return yield* worktrees.execute({ operationId, projectId, acquired });
          });

          const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
          yield* Effect.forkScoped(
            Stream.runForEach(listing.subscribe(projectId, { start: 0, limit: 3 }), (event) => Queue.offer(frames, event)),
          );
          yield* rig.next(frames, (event) => event.kind === 'list');

          const side = yield* make('side');
          const other = yield* make('other');
          const listed = yield* listing.list(projectId, {});
          const tagma = listed.rows.filter((row) => row.kind === 'tagma');
          const sideRow = tagma.find((row) => row.rootId === side.rootId);

          expect(listed.rows[0]?.kind).toBe('main');
          expect(sideRow?.status).toBe('idle');
          expect(sideRow?.base).toEqual({ branch: trunk, commit: yield* rig.headOf(checkout) });
          expect(sideRow?.branch).toBe('tagma/side');
          expect(new Set(tagma.map((row) => row.hue)).size).toBe(2);
          expect(tagma.map((row): string | null => row.rootId).sort()).toEqual([side.rootId, other.rootId].sort());
          yield* rig.next(frames, (event) => event.kind === 'list' && event.rows.length === 3);

          placed.push({
            threadId: 'agent-in-side',
            movedAt: new Date(yield* Clock.currentTimeMillis),
            rootId: side.rootId,
            cleared: false,
            state: 'working',
          });
          moved();
          const sideOf = (event: WorktreeFeedEvent): WorktreeRow | undefined =>
            event.kind === 'row'
              ? event.row.rootId === side.rootId
                ? event.row
                : undefined
              : event.kind === 'list'
                ? event.rows.find((row) => row.rootId === side.rootId)
                : undefined;
          const working = yield* rig.next(frames, (event) => sideOf(event)?.status === 'working');
          const carried = sideOf(working);
          expect(carried?.agents).toEqual({ working: 1, waiting: 0, finished: 0, standing: 1 });
          expect(carried?.threads).toEqual(['agent-in-side']);
          if (side.rootId === null) return yield* Effect.die('the creation registered no root');
          expect((yield* checkouts.read(side.rootId)).unwatched).toBe(false);

          rmSync(sideRow?.folder ?? '', { recursive: true, force: true });
          const after = yield* listing.list(projectId, {});
          const gone: WorktreeRow | undefined = after.rows.find((row) => row.rootId === side.rootId);
          expect(gone?.status).toBe('missing');
          yield* rig.next(frames, (event) => sideOf(event)?.status === 'missing');

          const otherRoot = other.rootId;
          if (otherRoot === null) return yield* Effect.die('the creation registered no root');
          yield* gitEffect(checkout, ['worktree', 'remove', '--force', other.destination]);
          yield* units.write('WorktreeListing', (unit) => operations.drop(otherRoot, unit));
          recordMoved(projectId);
          const left = yield* rig.next(frames, (event) => event.kind === 'list' && !event.rows.some((row) => row.rootId === otherRoot));
          expect(left.kind === 'list' ? left.rows.map((row): string => row.rootId).sort() : []).toEqual(
            after.rows
              .filter((row) => row.rootId !== otherRoot)
              .map((row) => row.rootId)
              .sort(),
          );
        });
      }),
  );
});
